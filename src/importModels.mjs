import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import Sequelize from 'sequelize'
import each from 'lodash/each'
import get from 'lodash/get'
import genPm from 'wsemi/src/genPm.mjs'
import modifyModel from './modifyModel.mjs'


async function importModels(fdModels, sequelize, name, sync = false) {

    //pm
    let pm = genPm()

    //file
    let file = `${name}.json`

    //fparent
    let fparent = path.resolve(fdModels) + path.sep

    //fn
    let fn = fparent + file
    // console.log('fn', fn)

    //modifyModel
    try {
        modifyModel(fn)
    }
    catch (err) {
        pm.reject(err)
        return pm
    }

    //import
    let model
    try {

        //model = sequelize.import(fn) //舊版sequelize才有import函數

        //s
        let j = fs.readFileSync(fn, 'utf8')
        let s = JSON5.parse(j)

        //抽換DataTypes, 例如將'DataTypes.STRING'改為DataTypes.STRING
        each(s.fields, (v) => {
            v.type = get(Sequelize, v.type, null)
        })

        //model, 使用define產生model
        model = sequelize.define(s.table, s.fields, s.options)
        // console.log('model', model)

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
