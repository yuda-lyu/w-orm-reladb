import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import Sequelize from 'sequelize'
import each from 'lodash/each'
import get from 'lodash/get'
import isBoolean from 'lodash/isBoolean'
import genPm from 'wsemi/src/genPm.mjs'
import modifyModel from './modifyModel.mjs'
import requireModel from './requireModel.js'


function readJsModel(fn, sequelize) {
    //model = sequelize.import(fn) //舊版sequelize才有import函數
    //model = require(fn)(sequelize, Sequelize.DataTypes)
    let model = requireModel(fn, sequelize, Sequelize.DataTypes)
    return model
}

function readJsonModel(fn, sequelize) {

    //s
    let j = fs.readFileSync(fn, 'utf8')
    let s = JSON5.parse(j)

    //抽換DataTypes, 例如將'DataTypes.TEXT'改為DataTypes.TEXT
    each(s.fields, (v) => {
        v.type = get(Sequelize, v.type, null)
    })

    //model, 使用define產生model
    let model = sequelize.define(s.table, s.fields, s.options)
    // console.log('model', model)

    return model
}

async function importModels(fdModels, sequelize, name, opt = {}) {

    //type
    let type = get(opt, 'type')
    if (type !== 'js' && type !== 'json') {
        type = 'js'
    }

    //sync
    let sync = get(opt, 'sync')
    if (!isBoolean(sync)) {
        sync = false
    }

    //pm
    let pm = genPm()

    //file
    let file = `${name}.${type}`

    //fparent
    let fparent = path.resolve(fdModels) + path.sep

    //fn
    let fn = fparent + file
    // console.log('fn', fn)

    //modifyModel
    try {
        modifyModel(fn, { type })
    }
    catch (err) {
        pm.reject(err)
        return pm
    }

    //import
    let model
    try {
        if (type === 'js') {
            model = readJsModel(fn, sequelize)
        }
        else if (type === 'json') {
            model = readJsonModel(fn, sequelize)
        }
    }
    catch (err) {
        pm.reject(err)
        return pm
    }

    //sync
    try {
        if (sync) {
            await model.sync() //{ force: true }
        }
    }
    catch (err) {
        pm.reject(err)
        return pm
    }

    //models
    let models = {}
    try {
        models[model.name] = model
    }
    catch (err) {
        pm.reject(err)
        return pm
    }

    //resolve
    pm.resolve(models)

    return pm
}


export default importModels
