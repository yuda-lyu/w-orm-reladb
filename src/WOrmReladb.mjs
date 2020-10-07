import path from 'path'
import events from 'events'
import Sequelize from 'sequelize'
import cloneDeep from 'lodash/cloneDeep'
import get from 'lodash/get'
import map from 'lodash/map'
import each from 'lodash/each'
import size from 'lodash/size'
import split from 'lodash/split'
import genPm from 'wsemi/src/genPm.mjs'
import genID from 'wsemi/src/genID.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import arrhas from 'wsemi/src/arrhas.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import pm2resolve from 'wsemi/src/pm2resolve.mjs'
import pmQueue from 'wsemi/src/pmQueue.mjs'
import WAutoSequelize from 'w-auto-sequelize/src/WAutoSequelize.mjs'
import importModels from './importModels.mjs'
import _genModelsByTabs from './genModelsByTabs.mjs'


/**
 * 操作關聯式資料庫
 *
 * 注意: 各model內id欄位不是主鍵(primary key)時需要強制更改成為主鍵，否則sequelize無法匯入
 *
 * @class
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.url='mssql://username:password@localhost:1433'] 輸入連接資料庫字串，預設'mssql://username:password@localhost:1433'
 * @param {String} [opt.storage='./worm.db'] 輸入sqlite資料庫檔案位置字串，預設'./worm.db'
 * @param {Boolean} [opt.useSqlcipher=false] 輸入是否使用sqlite加密套件[@journeyapps/sqlcipher]，型別為布林值，預設false，若是的話因依賴預設不安裝，得自行人工安裝
 * @param {String} [opt.db='worm'] 輸入使用資料庫名稱字串，預設'worm'
 * @param {String} [opt.cl='test'] 輸入使用資料表名稱字串，預設'test'
 * @param {String} [opt.fdModels='./models'] 輸入資料表models(各檔為*.js)所在資料夾字串，預設'./models'
 * @param {Boolean} [opt.logging=false] 輸入是否輸出實際執行的sql指令，型別為布林值，預設false
 * @param {String} [opt.pk='id'] 輸入數據主鍵字串，預設'id'
 * @param {Boolean} [opt.autoGenPK=true] 輸入若數據pk(id)欄位沒給時則自動給予隨機uuid，型別為布林值，預設true
 * @param {Boolean} [opt.useStable=true] 輸入是否使用穩定模式，使用佇列管理限定只能同時處理一種操作，型別為布林值，預設true
 * @returns {Object} 回傳操作資料庫物件，各事件功能詳見說明
 */
function WOrmReladb(opt = {}) {
    let ss
    let u
    let sequelize = null


    //default
    if (!opt.url) {
        opt.url = 'mssql://username:password@localhost:1433'
    }
    if (!opt.db) {
        opt.db = 'worm'
    }
    if (!opt.cl) {
        opt.cl = 'test'
    }
    if (!opt.fdModels) {
        opt.fdModels = './models'
    }
    opt.logging = (opt.logging === true)
    if (!opt.pk) {
        opt.pk = 'id'
    }
    if (!isbol(opt.autoGenPK)) {
        opt.autoGenPK = true
    }
    if (!isbol(opt.useStable)) {
        opt.useStable = true
    }
    if (!opt.storage) {
        opt.storage = './worm.db' //storage, only use for sqlite
    }
    opt.storage = path.resolve(opt.storage)
    if (!opt.useSqlcipher) {
        opt.useSqlcipher = false
    }


    //Op
    let Op = Sequelize.Op


    //ee
    let ee = new events.EventEmitter()


    //dialect
    let dialect
    ss = split(opt.url, '://')
    dialect = get(ss, 0, null)
    if (!dialect) {
        console.log('no dialect in opt.url')
        return ee
    }
    if (!arrhas(dialect, ['mssql', 'sqlite', 'mysql', 'mariadb', 'postgres'])) {
        console.log('invalid dialect in opt.url')
        return ee
    }
    u = get(ss, 1, '') //另存給後面使用


    //username, password
    let username
    let password
    // if (u.indexOf('@') < 0) {
    //     console.log('invalid username or password in opt.url')
    //     return ee
    // }
    ss = split(u, '@')
    u = get(ss, 1, '') //另存給後面使用
    ss = get(ss, 0, '')
    ss = split(ss, ':')
    if (size(ss) !== 2) {
        console.log('invalid username or password in opt.url')
        return ee
    }
    username = get(ss, 0, null)
    password = get(ss, 1, null)
    if (!username) {
        console.log('invalid username in opt.url')
        return ee
    }
    if (!password) {
        console.log('invalid password in opt.url')
        return ee
    }


    //host, port
    let host
    let port
    ss = split(u, ':')
    // if (size(ss) !== 2) {
    //     console.log('invalid host or port in opt.url')
    //     return ee
    // }
    host = get(ss, 0, null)
    port = get(ss, 1, null)
    if (dialect !== 'sqlite') {
        if (!host) {
            console.log('invalid host in opt.url')
            return ee
        }
        if (!port) {
            console.log('invalid port in opt.url')
            return ee
        }
    }


    /**
     * 初始化sequelize
     *
     * @memberOf WOrmReladb
     * @param {Boolean} [sync=false] 輸入當importModels匯入models時是否使用同步方式，將models資料變更至資料庫當中，此功能提供給createStorage之用
     * @returns {Promise} 回傳Promise，resolve代表關閉成功，reject回傳錯誤訊息
     */
    async function initSequelize(sync = false) {
        let err = null

        //optSeq
        let optSeq = {
            dialect,
            host,
            port,
            storage: opt.storage,
            logging: opt.logging,
            define: {
                //underscored: false,
                //freezeTableName: false,
                //syncOnAssociation: true,
                //charset: 'utf8',
                //dialectOptions: {
                //  collate: 'utf8_general_ci'
                //},
                timestamps: false
            },
            // pool: {
            //     max: 20,
            //     min: 0,
            //     acquire: 30000, //The maximum time, in milliseconds, that pool will try to get connection before throwing error
            //     idle: 10000 //The maximum time, in milliseconds, that a connection can be idle before being released.
            // },
            //sync: { force: true }, //強制同步
        }
        if (opt.useSqlcipher && dialect === 'sqlite') {
            optSeq.dialectModulePath = '@journeyapps/sqlcipher' //sqlite加密版
        }

        //sequelize
        sequelize = new Sequelize(opt.db, username, password, optSeq)
        if (opt.useSqlcipher && dialect === 'sqlite') {
            await sequelize.query('PRAGMA cipher_compatibility = 4') //設置sqlite密鑰相容性
            await sequelize.query(`PRAGMA key = '${username}:${password}'`) //設置slqite密碼為${username}:${password}, 為使用者名稱與密碼用冒號分隔
        }

        //mds, 若model內id不是pk則需要強制更改成為pk, 否則sequelize無法匯入
        let r = await pm2resolve(importModels)(opt.fdModels, sequelize, opt.cl, sync)

        //check
        if (r.state === 'error') {
            console.log(r)
            err = `can not import model: ${opt.cl}, need to use genModelsByDB, genModelsByTabs or create ${opt.cl}.json`
        }

        //mds
        let mds = r.msg

        return {
            mds,
            err,
        }
    }


    /**
     * 關閉sequelize
     *
     * @memberOf WOrmReladb
     * @returns {Promise} 回傳Promise，resolve代表關閉成功，reject回傳錯誤訊息
     */
    async function closeSequelize(from) {
        if (sequelize !== null) {
            await sequelize.close()
            //console.log(from, 'sequelize.close()')
        }
        sequelize = null
        //console.log(from, 'sequelize = null')
    }


    /**
     * 產生交易transaction狀態物件
     *
     * @memberOf WOrmReladb
     * @returns {Promise} 回傳Promise，resolve回傳交易transaction物件，reject回傳錯誤訊息
     */
    async function genTransaction() {
        let t
        if (sequelize !== null) {
            t = await sequelize.transaction() //使用Unmanaged transaction (then-callback)
            // t.afterCommit(() => {
            //     console.log('afterCommit')
            // })
        }
        else {
            return Promise.reject('invalid sequelize')
        }
        return t
    }


    /**
     * 查詢數據
     *
     * @memberOf WOrmReladb
     * @param {Object} [find={}] 輸入查詢條件物件
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳數據，reject回傳錯誤訊息
     */
    async function select(find = {}, option = {}) {

        function cvObj(o) {
            let oNew = {}
            each(o, (v, k) => {
                let kNew = k
                if (k.indexOf('$') >= 0) {
                    k = k.replace('$', '')
                    if (k === 'regex') {
                        kNew = Op.substring
                    }
                    else if (k === 'options') {
                        kNew = null
                    }
                    else if (k === 'nin') {
                        kNew = Op.notIn
                    }
                    else {
                        kNew = Op[k]
                    }
                }
                let vNew = v
                if (isarr(v)) {
                    vNew = cvArray(v)
                }
                else if (isobj(v)) {
                    vNew = cvObj(v)
                }
                if (kNew !== null) {
                    oNew[kNew] = vNew
                }
            })
            return oNew
        }

        function cvArray(o) {
            let oNew = []
            each(o, (v) => {
                let vNew = v
                if (isarr(v)) {
                    vNew = cvArray(v)
                }
                else if (isobj(v)) {
                    vNew = cvObj(v)
                }
                oNew.push(vNew)
            })
            return oNew
        }

        function cvFind(o) {
            let oNew = cvObj(o)
            return oNew
        }

        //find
        if (!isobj(find)) {
            find = {}
        }
        find = cloneDeep(find)

        //useFind
        let useFind = cvFind(find)

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useSqlcipher && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //si
        let si = instance
        if (instance === null) {
            si = await initSequelize()
        }
        // else {
        //     console.log('select use instance', instance)
        // }

        //rs
        let rs = null
        if (!si.err) {

            //md
            let md = si.mds[opt.cl]

            //setting
            let setting = {
                where: useFind,
                raw: true,
            }
            if (transaction !== null) {
                setting.transaction = transaction
            }

            //findAll
            rs = await md.findAll(setting)

        }
        else {
            ee.emit('error', si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('select')
        }

        return rs
    }


    /**
     * 插入數據，插入同樣數據會自動產生不同_id，故insert前需自行判斷有無重複
     *
     * @memberOf WOrmReladb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳插入結果，reject回傳錯誤訊息
     */
    async function insert(data, option = {}) {

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useSqlcipher && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //cloneDeep
        data = cloneDeep(data)

        //pm
        let pm = genPm()

        //si
        let si = instance
        if (instance === null) {
            si = await initSequelize()
        }
        // else {
        //     console.log('insert use instance', instance)
        // }

        if (!si.err) {

            //md
            let md = si.mds[opt.cl]

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //check
            if (opt.autoGenPK) {
                data = map(data, function(v) {
                    if (!v[opt.pk]) {
                        v[opt.pk] = genID()
                    }
                    return v
                })
            }

            //setting
            let setting = { }
            if (transaction !== null) {
                setting.transaction = transaction
            }

            //bulkCreate
            await md.bulkCreate(data, setting)
                .then((res) => {
                    res = { n: size(data), ok: 1 }
                    pm.resolve(res)
                    ee.emit('change', 'insert', data, res)
                })
                .catch(({ original }) => {
                    ee.emit('error', original)
                    pm.reject({ n: 0, ok: 0 })
                })

        }
        else {
            pm.reject(si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('insert')
        }

        return pm
    }


    /**
     * 儲存數據
     *
     * @memberOf WOrmReladb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @param {boolean} [option.autoInsert=true] 輸入是否於儲存時發現原本無數據，則自動改以插入處理，預設為true
     * @returns {Promise} 回傳Promise，resolve回傳儲存結果，reject回傳錯誤訊息
     */
    async function save(data, option = {}) {

        //cloneDeep
        data = cloneDeep(data)

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useSqlcipher && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //autoInsert
        let autoInsert = get(option, 'autoInsert', true)

        //pm
        let pm = genPm()

        //si
        let si = instance
        if (instance === null) {
            si = await initSequelize()
        }
        // else {
        //     console.log('save use instance', instance)
        // }

        if (!si.err) {

            //md
            let md = si.mds[opt.cl]

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //check
            if (opt.autoGenPK) {
                data = map(data, function(v) {
                    if (!v[opt.pk]) {
                        v[opt.pk] = genID()
                    }
                    return v
                })
            }

            // //tr
            // let t = null
            // let tr = {}
            // if (atomic) {
            //     t = await sequelize.transaction() //使用Unmanaged transaction (then-callback)
            //     tr = {
            //         transaction: t
            //     }
            // }

            //pmSeries
            await pmSeries(data, async function(v) {
                let pmm = genPm()

                //err
                let err = null

                //r
                let r
                if (v[opt.pk]) {
                    //有id

                    //setting
                    let setting = {
                        where: { [opt.pk]: v[opt.pk] },
                        raw: true,
                    }
                    if (transaction !== null) {
                        setting.transaction = transaction
                    }

                    //findOne
                    r = await md.findOne(setting)
                        .catch((error) => {
                            ee.emit('error', error)
                            err = error
                        })

                }
                else {
                    //沒有id
                    err = `${opt.pk} is invalid`
                }

                if (r) {
                    //有找到資料

                    //setting
                    let setting = {
                        where: { [opt.pk]: v[opt.pk] },
                    }
                    if (transaction !== null) {
                        setting.transaction = transaction
                    }

                    let rr = await md.update(v, setting)
                        .catch((error) => {
                            ee.emit('error', error)
                            err = error
                        })

                    if (rr) {
                        //console.log('update 有更新資料', rr)
                        pmm.resolve({ n: 1, nModified: 1, ok: 1 })
                    }
                    else {
                        //console.log('update 沒有更新資料', err)
                        pmm.resolve({ n: 0, nInserted: 0, ok: 1 })
                    }

                }
                else {
                    //沒有找到資料

                    //autoInsert
                    if (autoInsert) {

                        //setting
                        let setting = { }
                        if (transaction !== null) {
                            setting.transaction = transaction
                        }

                        //create
                        let rr = await md.create(v, setting)
                            .catch((error) => {
                                ee.emit('error', error)
                                err = error
                            })

                        if (rr) {
                            //console.log('create 有插入資料', rr)
                            pmm.resolve({ n: 1, nInserted: 1, ok: 1 })
                        }
                        else {
                            //console.log('create 沒有插入資料', err)
                            pmm.resolve({ n: 0, nInserted: 0, ok: 1 })
                        }

                    }
                    else {
                        //console.log('findOne 沒有找到資料也不自動插入', err)
                        pmm.resolve({ n: 0, nModified: 0, ok: 1 })
                    }

                }

                pmm._err = err //避免eslint錯誤訊息
                return pmm
            })
                .then((res) => {
                    pm.resolve(res)
                    ee.emit('change', 'save', data, res)
                })
                .catch((error) => {
                    pm.reject(error)
                })
            // if (!errAll) {
            //     // if (t) {
            //     //     //console.log('transaction commit')
            //     //     await t.commit()
            //     //         .then((res) => {
            //     //             pm.resolve(resAll)
            //     //             ee.emit('change', 'save', data, resAll)
            //     //         })
            //     //         .catch((error) => {
            //     //             //console.log('commit catch', error)
            //     //             ee.emit('error', error)
            //     //             pm.reject(error)
            //     //         })
            //     // }
            //     // else {
            //     //     pm.resolve(resAll)
            //     //     ee.emit('change', 'save', data, resAll)
            //     // }
            //     pm.resolve(resAll)
            //     ee.emit('change', 'save', data, resAll)
            // }
            // else {
            //     // if (t) {
            //     //     //console.log('transaction rollback')
            //     //     await t.rollback()
            //     //         .then((res) => {
            //     //             pm.reject(errAll)
            //     //         })
            //     //         .catch((error) => {
            //     //             //console.log('rollback catch', error)
            //     //             ee.emit('error', error)
            //     //             pm.reject(error)
            //     //         })
            //     // }
            //     // else {
            //     //     pm.reject(errAll)
            //     // }
            //     pm.reject(errAll)
            // }

        }
        else {
            pm.reject(si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('save')
        }

        return pm
    }


    /**
     * 刪除數據
     *
     * @memberOf WOrmReladb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳刪除結果，reject回傳錯誤訊息
     */
    async function del(data, option = {}) {

        //cloneDeep
        data = cloneDeep(data)

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useSqlcipher && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //pm
        let pm = genPm()

        //si
        let si = instance
        if (instance === null) {
            si = await initSequelize()
        }
        // else {
        //     console.log('del use instance', instance)
        // }

        if (!si.err) {

            //md
            let md = si.mds[opt.cl]

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //pmSeries
            await pmSeries(data, async function(v) {
                let pmm = genPm()

                //err
                let err = null

                //r
                let r
                if (v[opt.pk]) {
                    //有id

                    //setting
                    let setting = {
                        where: { [opt.pk]: v[opt.pk] },
                        raw: true,
                    }
                    if (transaction !== null) {
                        setting.transaction = transaction
                    }

                    //findOne
                    r = await md.findOne(setting)
                        .catch((error) => {
                            ee.emit('error', error)
                            err = error
                        })

                }
                else {
                    //沒有id
                    err = `${opt.pk} is invalid`
                }

                if (r) {
                    //有找到資料

                    //setting
                    let setting = {
                        where: { [opt.pk]: v[opt.pk] },
                    }
                    if (transaction !== null) {
                        setting.transaction = transaction //destroy的說明寫不需transaction但實際需要 (2020/10/07)
                    }

                    //destroy
                    let rr = await md.destroy(setting)
                        .catch((error) => {
                            ee.emit('error', error)
                            err = error
                        })

                    if (rr) {
                        //console.log('destroy 有刪除資料', rr)
                        pmm.resolve({ n: 1, nDeleted: 1, ok: 1 })
                    }
                    else {
                        //console.log('destroy 沒有刪除資料', err)
                        pmm.resolve({ n: 0, nDeleted: 0, ok: 1 })
                    }

                }
                else {
                    //console.log('findOne 沒有找到資料', err)
                    pmm.resolve({ n: 1, nDeleted: 1, ok: 1 })
                }

                pmm._err = err //避免eslint錯誤訊息
                return pmm
            })
                .then((res) => {
                    pm.resolve(res)
                    ee.emit('change', 'del', data, res)
                })
                .catch((res) => {
                    pm.reject(res)
                })

        }
        else {
            pm.reject(si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('del')
        }

        return pm
    }


    /**
     * 刪除全部數據，需與del分開，避免未傳數據導致直接刪除全表
     *
     * @memberOf WOrmReladb
     * @param {Object} [find={}] 輸入刪除條件物件
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳刪除結果，reject回傳錯誤訊息
     */
    async function delAll(find = {}, option = {}) {

        //find
        if (!isobj(find)) {
            find = {}
        }
        find = cloneDeep(find)

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useSqlcipher && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //pm
        let pm = genPm()

        //si
        let si = instance
        if (instance === null) {
            si = await initSequelize()
        }
        // else {
        //     console.log('delAll use instance', instance)
        // }

        if (!si.err) {

            //md
            let md = si.mds[opt.cl]

            //setting
            let setting = {
                where: find,
            }
            if (transaction !== null) {
                setting.transaction = transaction //destroy的說明寫不需transaction但實際需要 (2020/10/07)
            }

            //destroy
            await md.destroy(setting)
                .then((res) => {
                    res = { n: res, ok: 1 }
                    pm.resolve(res)
                    ee.emit('change', 'delAll', null, res)
                })
                .catch((error) => {
                    ee.emit('error', error)
                    pm.reject({ n: 0, ok: 1 })
                })

        }
        else {
            pm.reject(si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('delAll')
        }

        return pm
    }


    /**
     * 創建sqlite資料庫檔案
     *
     * @memberOf WOrmReladb
     * @returns {Promise} 回傳Promise，resolve回傳創建結果，reject回傳錯誤訊息
     */
    async function createStorage() {

        //pm
        let pm = genPm()

        //initSequelize
        let si = await initSequelize(true)

        //closeSequelize
        await closeSequelize('createStorage')

        //check
        if (si.err) {
            pm.reject(si.err)
        }
        else {
            pm.resolve('created')
        }

        return pm
    }


    /**
     * 由指定資料庫生成各資料表的models資料
     *
     * include from: [w-auto-sequelize](https://github.com/yuda-lyu/w-auto-sequelize)
     *
     * @memberOf WOrmReladb
     * @param {Object} [option={}] 輸入設定物件，預設{}
     * @param {String} [option.storage='./worm.db'] 輸入sqlite資料庫檔案位置字串，預設'./worm.db'
     * @param {String} [option.db='worm'] 輸入資料庫名稱字串，預設'worm'
     * @param {String} [option.username='username'] 輸入使用者名稱字串，預設'username'
     * @param {String} [option.password='password'] 輸入密碼字串，預設'password'
     * @param {String} [option.dialect='mssql'] 輸入資料庫種類字串，預設'mssql'，可選'mssql', 'sqlite', 'mysql', 'mariadb', 'postgres'
     * @param {String} [option.fdModels='./models'] 輸入models儲存的資料夾名稱字串，預設'./models'
     * @param {String} [option.host='localhost'] 輸入連線主機host位址字串，預設'localhost'
     * @param {Integer} [option.port=1433] 輸入連線主機port整數，預設1433
     * @returns {Promise} 回傳Promise，resolve回傳產生的models資料，reject回傳錯誤訊息
     */
    function genModelsByDB(option = {}) {

        //default
        let def = {
            username: 'username',
            password: 'password',
            dialect: 'mssql',
            host: 'localhost',
            port: 1433,
            storage: './worm.db',
        }

        //merge
        option = {
            ...def,
            ...option,
        }

        //database
        if (!option.db) {
            option.db = 'worm'
        }
        option.database = opt.db

        //directory
        if (!option.fdModels) {
            option.fdModels = './models'
        }
        option.directory = opt.fdModels

        //storage
        option.storage = path.resolve(option.storage)

        //WAutoSequelize
        return WAutoSequelize(option)

    }


    /**
     * 由資料表物件生成各資料表的models資料
     *
     * @memberOf WOrmReladb
     * @param {String} [fd='./models'] 輸入models儲存的資料夾名稱字串，預設'./models'
     * @param {String} [tabs={}] 輸入各資料表物件，預設{}
     */
    function genModelsByTabs(fd = './models', tabs = {}) {
        _genModelsByTabs(fd, tabs)
    }


    //bind
    ee.createStorage = createStorage
    ee.genModelsByDB = genModelsByDB
    ee.genModelsByTabs = genModelsByTabs
    ee.init = initSequelize
    ee.close = () => {
        return closeSequelize('external')
    }
    ee.genTransaction = genTransaction
    if (opt.useStable) {
        //用佇列(同時最大執行數1且先進先執行)處理高併發之情形
        //若沒管控, 例如sqlite會報錯[Error: SQLITE_MISUSE: Database is closed]問題
        let q = pmQueue(1)
        ee.select = function() {
            return q.run(select, ...arguments)
        }
        ee.insert = function() {
            return q.run(insert, ...arguments)
        }
        ee.save = function() {
            return q.run(save, ...arguments)
        }
        ee.del = function() {
            return q.run(del, ...arguments)
        }
        ee.delAll = function() {
            return q.run(delAll, ...arguments)
        }
    }
    else {
        ee.select = select
        ee.insert = insert
        ee.save = save
        ee.del = del
        ee.delAll = delAll
    }

    return ee
}


export default WOrmReladb