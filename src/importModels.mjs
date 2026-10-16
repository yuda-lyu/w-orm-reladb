import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import Sequelize from 'sequelize'
import each from 'lodash-es/each.js'
import get from 'lodash-es/get.js'
import isBoolean from 'lodash-es/isBoolean.js'
import genPm from 'wsemi/src/genPm.mjs'
import requireModel from './requireModel.js'


//匯入資料表設定檔(models)
//
//model內之id欄位須為主鍵, 否則sequelize拒絕匯入(model.js: A column called 'id' was added ... but not marked with 'primaryKey: true')
//原版以modifyModel於[每一次]匯入時無條件重寫呼叫端之model原始檔(逐行trim、刪空行並改為LF)以補上主鍵設定,
//而本套件每次操作(含select、selectByPk)皆匯入一次, 故讀取函數亦改變可被觀察之狀態(規格T9),
//且多行程併發時一方正截斷檔案而另一方讀取, 即讀到空內容並寫回空檔而[永久損毀](已實機重現: 4行程併發, 4/4輪model檔被截為0位元組)
//
//本版改於記憶體內補上主鍵設定, 一律不寫model檔:
//  js格式於呼叫model之定義函數期間暫時包裝sequelize.define, 於定義前補上id之primaryKey
//  json格式於解析後、define前補上


/**
 * 令欄位定義之id為主鍵, 不改動傳入之物件
 * 註: 僅於model完全沒有主鍵設定而有id欄時補上(sequelize於此情形拒絕匯入);
 * model已有其他主鍵時不改動, 否則成為(既有主鍵, id)之複合主鍵而使主鍵去重失效(原版modifyModel有此缺陷)
 *
 * @ignore
 * @param {Object} attrs 輸入欄位定義物件
 * @returns {Object} 回傳欄位定義物件
 */
function patchIdPk(attrs) {

    //check
    if (!attrs || !Object.prototype.hasOwnProperty.call(attrs, 'id')) {
        return attrs
    }

    //check, 已有任一主鍵設定者不改動
    let hasPk = Object.keys(attrs).some((k) => get(attrs[k], 'primaryKey') === true)
    if (hasPk) {
        return attrs
    }

    //id
    let id = attrs.id

    //idNew, id可為欄位設定物件或直接為型別
    let idNew = Object.prototype.toString.call(id) === '[object Object]' && get(id, 'type') !== undefined
        ? { ...id, primaryKey: true }
        : { type: id, primaryKey: true }

    return { ...attrs, id: idNew }
}


/**
 * 讀取js格式之model
 * 註: 於呼叫model之定義函數期間暫時以實例自有屬性包裝define, 結束後刪除該屬性即回復原型上之define
 *
 * @ignore
 */
function readJsModel(fn, sequelize) {
    let define = sequelize.define
    sequelize.define = function(name, attrs, options) {
        return define.call(sequelize, name, patchIdPk(attrs), options)
    }
    try {
        return requireModel(fn, sequelize, Sequelize.DataTypes)
    }
    finally {
        delete sequelize.define
    }
}


/**
 * 讀取json格式之model
 *
 * @ignore
 */
function readJsonModel(fn, sequelize) {

    //s
    let j = fs.readFileSync(fn, 'utf8')
    let s = JSON5.parse(j)

    //抽換DataTypes, 例如將'DataTypes.TEXT'改為DataTypes.TEXT
    each(s.fields, (v) => {
        v.type = get(Sequelize, v.type, null)
    })

    //model, 使用define產生model, 定義前於記憶體內補上id之主鍵設定
    let model = sequelize.define(s.table, patchIdPk(s.fields), s.options)

    return model
}


/**
 * 匯入資料表設定檔
 *
 * 註: 不寫入model檔, id之主鍵設定於記憶體內補上
 *
 * @param {String} fdModels 輸入models所在資料夾字串
 * @param {Object} sequelize 輸入sequelize實例
 * @param {String} name 輸入資料表名稱字串
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.type='js'] 輸入資料表設定檔類型字串，可有'js'、'json'
 * @param {Boolean} [opt.sync=false] 輸入是否將models資料同步至資料庫
 * @returns {Promise} 回傳Promise，resolve回傳models物件，reject回傳錯誤訊息
 */
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
