import path from 'path'
import genPm from 'wsemi/src/genPm.mjs'
import modifyModel from './modifyModel.mjs'


async function importModels(fdModels, sequelize, name, sync = false) {

    //pm
    let pm = genPm()

    //file
    let file = `${name}.js`

    //fparent
    let fparent = path.resolve(fdModels) + path.sep

    //fn
    let fn = fparent + file

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
        model = sequelize.import(fn)
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
