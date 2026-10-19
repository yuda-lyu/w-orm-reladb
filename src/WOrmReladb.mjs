import path from 'path'
import Sequelize from 'sequelize'
import cloneDeep from 'lodash-es/cloneDeep.js'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import split from 'lodash-es/split.js'
import keys from 'lodash-es/keys.js'
import pick from 'lodash-es/pick.js'
import omit from 'lodash-es/omit.js'
import isEqual from 'lodash-es/isEqual.js'
import evem from 'wsemi/src/evem.mjs'
import genPm from 'wsemi/src/genPm.mjs'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import arrHas from 'wsemi/src/arrHas.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import pm2resolve from 'wsemi/src/pm2resolve.mjs'
import pmQueue from 'wsemi/src/pmQueue.mjs'
import WAutoSequelize from 'w-auto-sequelize/src/WAutoSequelize.mjs'
import importModels from './importModels.mjs'
import _genModelsByTabs from './genModelsByTabs.mjs'
import cvFind, { getColKind, getColScale, normPk, chkFindShape } from './cvFind.mjs'


//放置於全域宣告, 若使用useStable=true才可於當創建多實例時仍能全域控管
let pmq = pmQueue(1)


/**
 * 操作關聯式資料庫
 *
 * 注意: 各model內id欄位不是主鍵(primary key)時需要強制更改成為主鍵，否則sequelize無法匯入
 *
 * @class
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.url='mssql://username:password@localhost:1433'] 輸入連接資料庫字串，資料庫可選'mssql'、'sqlite'、'mysql'、'mariadb'、'postgres'，預設'mssql://username:password@localhost:1433'
 * @param {String} [opt.storage='./worm.db'] 輸入為sqlite時，資料庫檔案所在位置字串，預設'./worm.db'
 * @param {Boolean} [opt.useEncryption=false] 輸入為sqlite時是否使用加密套件[@journeyapps/sqlcipher]，型別為布林值，預設false，若是的話因依賴預設不安裝，得自行人工安裝
 * @param {String} [opt.db='worm'] 輸入使用資料庫名稱字串，預設'worm'
 * @param {String} [opt.cl='test'] 輸入使用資料表名稱字串，預設'test'
 * @param {String} [opt.fdModels='./models'] 輸入資料表設定檔所在資料夾字串，預設'./models'
 * @param {String} [opt.modelType='js'] 輸入資料表設定檔類型字串，可有'js'、'json'，預設'js'
 * @param {Boolean} [opt.logging=false] 輸入是否輸出實際執行的sql指令布林值，預設false
 * @param {String} [opt.pk='id'] 輸入數據主鍵字串，預設'id'
 * @param {Boolean} [opt.autoGenPk=true] 輸入若數據pk(id)欄位沒給時則自動給予隨機uuid，型別為布林值，預設true
 * @param {Boolean} [opt.useStable=true] 輸入是否使用穩定模式，使用佇列管理同時只能進行一種操作故會犧牲效能，sqlite需開啟穩定模式才不會有非預期錯誤，型別為布林值，預設true
 * @returns {Object} 回傳操作資料庫物件，各事件功能詳見說明
 */
function WOrmReladb(opt = {}) {
    let ss
    let u
    let sequelize = null


    //default
    if (!isestr(opt.url)) {
        opt.url = 'mssql://username:password@localhost:1433'
    }
    if (!isestr(opt.db)) {
        opt.db = 'worm'
    }
    if (!isestr(opt.cl)) {
        opt.cl = 'test'
    }
    if (!isestr(opt.fdModels)) {
        opt.fdModels = './models'
    }
    if (!isestr(opt.modelType)) {
        opt.modelType = 'js'
    }
    opt.logging = (opt.logging === true)
    if (!isestr(opt.pk)) {
        opt.pk = 'id'
    }
    if (!isbol(opt.autoGenPk)) {
        opt.autoGenPk = true
    }
    if (!isbol(opt.useStable)) {
        opt.useStable = true
    }
    if (!isestr(opt.storage)) {
        opt.storage = './worm.db' //storage, only use for sqlite
    }
    opt.storage = path.resolve(opt.storage)
    if (!isbol(opt.useEncryption)) {
        opt.useEncryption = false
    }


    //ee, 採wsemi之evem(即eventemitter3), 其於'error'無監聽者時僅回傳false而不拋出,
    //故本套件之操作行為不因呼叫端有無註冊監聽而改變; Node內建之EventEmitter具該拋出語義, 不可用
    let ee = evem()


    //opt.url解析失敗一律拋出, 因其屬呼叫端未履行契約, 且解析失敗後各函數皆無從運作,
    //建構為同步而無從以Promise.reject回報, 拋出即為reject之同步對應;
    //若僅console.log而回傳未綁定各函數之ee, 錯誤不經任何管道抵達呼叫端, 呼叫端僅得到
    //[w.select is not a function]之無關訊息, 與本規格[錯誤不得靜默]之通則相違
    let throwUrlErr = (msg) => {
        throw new Error(`${msg}, opt.url[${opt.url}]`)
    }


    //dialect
    let dialect
    ss = split(opt.url, '://')
    dialect = get(ss, 0, null)
    if (!dialect) {
        throwUrlErr('no dialect in opt.url')
    }
    if (!arrHas(dialect, ['mssql', 'sqlite', 'mysql', 'mariadb', 'postgres'])) {
        throwUrlErr('invalid dialect in opt.url')
    }
    u = get(ss, 1, '') //另存給後面使用


    //username, password
    let username
    let password
    ss = split(u, '@')
    u = get(ss, 1, '') //另存給後面使用
    ss = get(ss, 0, '')
    ss = split(ss, ':')
    if (size(ss) !== 2) {
        throwUrlErr('invalid username or password in opt.url')
    }
    username = get(ss, 0, '')
    password = get(ss, 1, '')
    if (dialect !== 'sqlite' || (dialect === 'sqlite' && opt.useEncryption)) {
        if (username === '') {
            throwUrlErr('invalid username in opt.url')
        }
        if (password === '') {
            throwUrlErr('invalid password in opt.url')
        }
    }


    //host, port
    let host
    let port
    ss = split(u, ':')
    host = get(ss, 0, null)
    port = get(ss, 1, null)
    if (dialect !== 'sqlite') {
        if (!host) {
            throwUrlErr('invalid host in opt.url')
        }
        if (!port) {
            throwUrlErr('invalid port in opt.url')
        }
    }


    /**
     * 取錯誤訊息字串，供逐筆結果之err欄位與error事件使用
     *
     * @ignore
     * @param {Error|String} err 輸入錯誤物件或字串
     * @returns {String} 回傳錯誤訊息字串
     */
    function getErrMsg(err) {

        //message
        let message = get(err, 'message')
        if (isestr(message)) {
            return message
        }

        return String(err)
    }


    /**
     * 發出change事件，訂閱函數拋錯不得影響本次操作之結果，故另包try並自行吞掉
     *
     * @ignore
     * @param {String} mode 輸入操作別字串
     * @param {Object|Array|null} data 輸入本次操作之數據
     * @param {Object|Array} res 輸入本次操作之結果
     * @returns {undefined} 無回傳值
     */
    function emitChange(mode, data, res) {
        try {
            ee.emit('change', mode, data, res)
        }
        catch (err) {
            console.log(err)
        }
    }


    /**
     * 發出error事件，操作發生錯誤時發出，錯誤訊息一律轉為字串
     * 註: 事件僅為附加通知，所送出之資訊必另有正規管道——整批性錯誤經Promise.reject，逐筆失敗經該筆之err欄位
     * 註: 訂閱函數拋錯不得影響本次操作之結果，故另包try並自行吞掉
     * 註: 正常結果不得發出本事件，如insert全數已存在、save合併後內容相同、del主鍵未命中、selectByPk查無數據
     *
     * @ignore
     * @param {String} mode 輸入操作別字串
     * @param {Object|Array|null} data 輸入本次操作之數據
     * @param {Error|String} err 輸入錯誤物件或字串
     * @returns {undefined} 無回傳值
     */
    function emitError(mode, data, err) {
        try {
            ee.emit('error', mode, data, getErrMsg(err))
        }
        catch (errEmit) {
            console.log(errEmit)
        }
    }


    /**
     * 判定主鍵值是否有效(與主鍵欄型別無關之判定)
     * 註: select以外之五函數對主鍵之認定一律以本函數與normPkOf為準，令selectByPk之[命中]與insert、save、del內對既有數據之認定一致
     * 註: 有效即非空字串或有限數值(含0), new String與new Number取原始值; NaN、±Infinity、布林、物件等為無效(見cvFind.mjs之normPk)
     *
     * @ignore
     * @param {*} v 輸入主鍵值
     * @returns {Boolean} 回傳主鍵值是否有效布林值
     */
    function isEffPk(v) {
        return normPk(v, 'any').kind !== 'invalid'
    }


    /**
     * 判定是否為主鍵重複之錯誤
     * 註: sequelize於mssql、sqlite、mysql、mariadb、postgres皆將唯一鍵衝突轉為UniqueConstraintError，故此判定與dialect無關
     *
     * @ignore
     * @param {Error} err 輸入錯誤物件
     * @returns {Boolean} 回傳是否為主鍵重複錯誤布林值
     */
    function isDupPkError(err) {
        return err instanceof Sequelize.UniqueConstraintError
    }


    /**
     * 檢查呼叫端所給之實例是否已關閉，已關閉者拋出令各函數於入口快速失敗
     * 註: 實例已關閉為終態，後續操作必然失敗，屬影響全部數據之整批性錯誤，
     * 故不得降為逐筆ok為0而整批resolve，亦不得以正常空結果(null、未命中、空陣列)回應——
     * 後者使[已關閉]與[查無資料]同形，去重類呼叫端將把每筆判為未存在而靜默fail-open
     * 註: closeSequelize於關閉後將sequelize設為null，故據此判定即為精確訊號，
     * 不須倚賴驅動層之錯誤訊息比對(連線管理器關閉後所拋者為原生Error而非sequelize之錯誤類別)
     * 註: 內部自行初始化者(instance為null)每次呼叫各自開關連線，不受本檢查影響
     *
     * @ignore
     * @param {Object|null} instance 輸入呼叫端所給之實例物件
     * @returns {undefined} 無回傳值
     */
    function procClosed(instance) {

        //check
        if (instance === null) {
            return
        }

        //check
        if (sequelize === null) {
            throw new Error(`instance is closed, need to use init() to get a new instance`)
        }

    }


    /**
     * 判定錯誤是否影響後續所有筆數而應視為整批性錯誤
     * 註: 依T4之判別原則，錯誤只影響該筆資料者為逐筆失敗，影響後續所有筆數者為整批性錯誤；
     * 連線層錯誤屬後者，故於逐筆函數內攔得時須往外拋而不得降為該筆ok為0
     * 註: 連線管理器關閉後所拋者為原生Error而非sequelize之ConnectionError，故另以訊息辨識
     *
     * @ignore
     * @param {Error} err 輸入錯誤物件
     * @returns {Boolean} 回傳是否為整批性錯誤布林值
     */
    function isBatchLevelError(err) {

        //check, sequelize之連線層錯誤家族
        if (err instanceof Sequelize.ConnectionError) {
            return true
        }

        //msg
        let msg = getErrMsg(err)

        //check
        if (msg.indexOf('connection manager was closed') >= 0) {
            return true
        }
        if (msg.indexOf('SQLITE_MISUSE') >= 0) {
            return true
        }

        return false
    }


    /**
     * 取cvFind所需之依賴物件
     * 註: attrs供欄名解析(嚴格鍵)與依欄位型別檢核條件之純量, pk令主鍵欄之條件值依normPk正規化而與主鍵函數一致
     *
     * @ignore
     * @param {Object} md 輸入資料表model物件
     * @returns {Object} 回傳{attrs, pk}
     */
    function getFindCtx(md) {
        return {
            attrs: get(md, 'rawAttributes', {}),
            pk: opt.pk,
        }
    }


    /**
     * 檢查model之預設scope是否會使select與delAll之對象分歧
     * 註: defaultScope帶limit或offset時, select依其order取前幾筆, 而sequelize之限量刪除不採order(sqlite為rowid IN子查詢),
     * 兩者命中之數據不同而會刪錯列, 故delAll遇此類model即拒絕
     * 註: defaultScope帶group或having時, findAll套用而destroy不套用(having過濾後只回部分列, 卻刪除全部符合where者);
     * 帶非空之include時, findAll以INNER JOIN篩列(required)而destroy不JOIN; 兩者亦拒絕
     * 註: defaultScope.where含Op.and時, sequelize以Object.assign合併scope與cvFind輸出之where, 後者頂層恆為Op.and而覆寫scope之條件(select與delAll皆然),
     * delAll會刪到scope範圍外之列, 故拒絕; 其他鍵(含Op.or)與cvFind輸出之Op.and並存而以AND結合, 不受影響
     *
     * @ignore
     * @param {Object} md 輸入資料表model物件
     * @returns {undefined} 無回傳值
     */
    function chkScopeForDelAll(md) {
        let sc = get(md, '_scope', {})
        let bads = []
        for (let k of ['limit', 'offset']) {
            if (get(sc, k) !== undefined) {
                bads.push(k)
            }
        }
        for (let k of ['group', 'having']) {
            let v = get(sc, k)
            if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) {
                bads.push(k)
            }
        }
        if (isearr(get(sc, 'include'))) {
            bads.push('include')
        }
        let w = get(sc, 'where')
        if (w !== null && typeof w === 'object' && Object.prototype.hasOwnProperty.call(w, Sequelize.Op.and)) {
            bads.push('where[Op.and]')
        }
        if (bads.length > 0) {
            throw new Error(`model [${opt.cl}] has defaultScope with ${bads.join(', ')}, delAll can not delete the same rows as select`)
        }
    }


    /**
     * 正規化各筆數據之主鍵值並就地寫回, 型別不符者整批拋出
     * 註: 須於procPk之後、任何寫入之前一次完成; 已給主鍵而型別不符屬呼叫端未履行契約, 不以自動產生之主鍵取代
     * 註: 正規化值寫回數據, 令寫入值與其後各函數之比對值一致(如字串類主鍵欄之123存為'123'), 事件之數據亦為實際寫入者
     *
     * @ignore
     * @param {Object} md 輸入資料表model物件
     * @param {Array} data 輸入已補齊主鍵之數據陣列
     * @returns {undefined} 無回傳值
     */
    function normPks(md, data) {
        data.forEach((v, k) => {
            let r = normPkOf(md, get(v, opt.pk))
            if (r.kind !== 'ok') {
                throw new Error(`invalid data[${k}].${opt.pk}[${get(v, opt.pk)}], type does not match pk column [${opt.pk}]`)
            }
            v[opt.pk] = r.v
        })
    }


    /**
     * 依model之主鍵欄型別正規化主鍵值
     * 註: 規則見cvFind.mjs之normPk(與w-orm-mdb同一規則), 用於selectByPk、del、save、insert與insertBulk,
     * 並與select、delAll之主鍵欄條件共用, 令各函數對主鍵之命中判定一致; 字串類主鍵欄之有限數字以String(v)處置,
     * 整數類收安全整數與標準整數寫法之字串, DECIMAL之小數位不得多於scale, 型別不符者即規格之[主鍵值無效(型別不符)]而不送查詢
     *
     * @ignore
     * @param {Object} md 輸入資料表model物件
     * @param {*} v 輸入主鍵值
     * @returns {Object} 回傳{kind,v}, kind為'ok'、'invalid'或'mismatch'
     */
    function normPkOf(md, v) {
        let attrs = get(md, 'rawAttributes', {})
        return normPk(v, getColKind(attrs, opt.pk), getColScale(attrs, opt.pk))
    }


    /**
     * 檢查並補齊單筆數據之主鍵
     * autoGenPk為true時未帶有效主鍵者自動產生，為false時往外拋
     * 註: 未帶有效主鍵屬呼叫端未履行契約而非某一筆資料本身之問題，故為整批性錯誤而不降級為該筆ok為0，
     * 若降級為逐筆結果，呼叫端易於整批resolve之下漏看，使[忘了給主鍵]靜默變成[少寫了幾筆]
     * 註: 本函數須於任何寫入之前一次對全部數據完成，令拋錯時同批之有效筆數亦不會被寫入
     * 註: 自動產生之主鍵值為字串，故補值前檢查主鍵欄位確為字串類型，不符者以明確訊息拋出，
     * 而非任由資料庫回報型別錯誤; 本套件之model定義於手上得知主鍵型別，故不適用T6之[套件無從得知主鍵型別]例外
     *
     * @ignore
     * @param {Object} md 輸入資料表model物件
     * @param {Object} v 輸入數據物件
     * @param {Number} k 輸入數據於陣列內之索引
     * @returns {Object} 回傳補齊主鍵之數據物件
     */
    function procPk(md, v, k) {

        //check
        if (isEffPk(get(v, opt.pk))) {
            return v
        }

        //check, autoGenPk為false時主鍵須由呼叫端自備
        if (!opt.autoGenPk) {
            throw new Error(`invalid data[${k}].${opt.pk}, autoGenPk is false`)
        }

        //at
        let at = get(md, `rawAttributes.${opt.pk}`)
        if (!iseobj(at)) {
            throw new Error(`can not find pk column [${opt.pk}] in model [${opt.cl}]`)
        }

        //check, 自動產生之主鍵值為字串, 主鍵欄位須為字串類型方能容納
        let tp = get(at, 'type.key', '')
        if (!arrHas(tp, ['STRING', 'TEXT', 'CHAR', 'UUID', 'CITEXT'])) {
            throw new Error(`autoGenPk is true but pk column [${opt.pk}] in model [${opt.cl}] is [${tp}], auto generated pk is a string, need to set autoGenPk to false and supply pk by caller`)
        }

        //genIDSeq, 為UUIDv7格式而具單調遞增性, 主鍵接近順序遞增可減少索引頁面分裂
        v[opt.pk] = genIDSeq()

        return v
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
        if (opt.useEncryption && dialect === 'sqlite') {
            optSeq.dialectModulePath = '@journeyapps/sqlcipher' //sqlite加密版
        }

        //sequelize
        sequelize = new Sequelize(opt.db, username, password, optSeq)
        if (opt.useEncryption && dialect === 'sqlite') {
            await sequelize.query('PRAGMA cipher_compatibility = 4') //設置sqlite密鑰相容性
            await sequelize.query(`PRAGMA key = '${username}:${password}'`) //設置slqite密碼為${username}:${password}, 為使用者名稱與密碼用冒號分隔
        }

        //importModels, 若model內id不是pk則需要強制更改成為pk, 否則sequelize無法匯入
        let r = await pm2resolve(importModels)(opt.fdModels, sequelize, opt.cl, { sync, type: opt.modelType })

        //check
        if (r.state === 'error') {
            console.log(r)
            err = `can not import model: ${opt.cl}, need to use genModelsByDB, genModelsByTabs or create ${opt.cl}.${opt.modelType}`
        }

        //mds
        let mds = r.msg

        return {
            mds,
            err,
            close: () => {
                return closeSequelize('external')
            },
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
     * 產生交易transaction狀態物件，當使用transaction時資料庫會上鎖，只能供調用的連線操作處理
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
     * 使用須知(條件find為系列白名單, 規則同delAll, 見CLAUDE_rulebook.md之R11):
     * 1. 不給條件即查詢全部數據: find未給、為undefined或為{}時回傳全部數據; 給了條件才是部分查詢。
     * 2. 傳了值卻不是條件物件(null、陣列含[]與[{...}]、字串、數值、布林、函數、Date、RegExp、Map、Set、類別實例等)
     *    一律整批reject, 不視為{}。
     * 3. 條件僅支援系列白名單: 欄位等值{欄:純量}(多欄為AND)、欄位運算子$eq $ne $gt $gte $lt $lte(值為純量)與
     *    $in $nin(值為純量陣列)、文件層$and $or(值為條件物件之非空陣列, 最多999項)。純量為字串、有限數字、布林、有效Date;
     *    null僅可用於欄位等值、$eq、$ne。白名單外之運算子($not $nor $regex $options $exists $where $expr $like $ilike等)、
     *    sequelize之Op Symbol、RegExp值、陣列值(請改用$in)、欄位層$and/$or、函數值、Symbol鍵、undefined值、空的$nin/$and/$or等
     *    一律整批reject, 訊息為invalid find: 原因 at [路徑], 且於載入model與連線前即檢核。
     * 4. 欄名須完全等於model之屬性名或資料庫欄名(區分大小寫), 且為字母或底線開頭之字母/數字/底線(最多128字元);
     *    純量須符合欄位型別(如數值欄給'abc'會reject); 主鍵欄之條件值依主鍵欄型別正規化(字串類主鍵欄之{id:123}即{id:'123'})。
     * 5. 與delAll共用同一檢核與同一條件, select(find)命中之數據即delAll(find)刪除之數據。
     * 6. 語意差異(SQL式): $ne/$nin不命中欄位為NULL之數據(三值邏輯)。需明確表達時可用可攜寫法:
     *    排除NULL為{$and:[{f:{$ne:null}},{f:{$ne:x}}]}, 含NULL為{$or:[{f:null},{f:{$ne:x}}]}; 字串比對之大小寫依資料庫定序。
     *
     * 註: 恆回傳陣列, 無符合數據回傳空陣列
     *
     * @memberOf WOrmReladb
     * @param {Object} [find={}] 輸入查詢條件物件(系列白名單, 規則同delAll之使用須知第1-4點); 未給、undefined或{}回傳全部數據; 非條件物件或白名單外運算子整批reject
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳數據陣列，reject回傳錯誤訊息
     */
    async function select(find = {}, option = {}) {

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useEncryption && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //isErr, res
        let isErr = false
        let res = null

        //si
        let si = instance

        //inited, 本次呼叫是否已進入initSequelize(僅此時finally才關閉sequelize; 預檢失敗於其前者不得關閉呼叫端先前持有之連線)
        let inited = false

        try {

            //check, 實例已關閉屬整批性錯誤, 於入口快速失敗
            procClosed(instance)

            //chkFindShape, 條件形狀不合法者(系列白名單, R11)於載入model與建立sequelize實例之前即拋錯: 不連線、不送出任何SQL, reject並發出error事件; 其後只使用檢核後之複本
            let fd = chkFindShape(find)

            //initSequelize, 內部自動初始化須在try內: 其例外(如驅動缺失)與si.err同屬整批性錯誤, 方能於reject前發出error事件, 已建構之sequelize亦由finally關閉
            if (instance === null) {
                inited = true
                si = await initSequelize()
            }

            //check, 連線或匯入models失敗影響本次操作之全部數據, 屬整批性錯誤
            if (si.err) {
                throw si.err
            }

            //md
            let md = si.mds[opt.cl]

            //useFind, 與delAll共用cvFind(對複本再檢核一次, 冪等), 欄名、欄位型別等翻譯層不合法者於此拋錯而reject並發出error事件
            let useFind = cvFind(fd, getFindCtx(md))

            //setting, raw令回傳純數據物件而不含資料庫內部欄位
            let setting = {
                where: useFind,
                raw: true,
            }
            if (transaction !== null) {
                setting.transaction = transaction
            }

            //findAll, 恆回傳陣列, 無符合數據為空陣列
            res = await md.findAll(setting)
            if (!isarr(res)) {
                res = []
            }

        }
        catch (err) {
            isErr = true
            res = err
        }
        finally {

            //closeSequelize
            if (instance === null && inited) { //內部自動初始化得close
                await closeSequelize('select')
            }

        }

        //check
        if (isErr) {
            emitError('select', null, res)
            return Promise.reject(res)
        }

        return res
    }


    /**
     * 由主鍵查詢單筆數據，因由資料庫依主鍵索引取值且僅回傳單筆，不需如select提取全部符合數據再處理，故數據量大時效能較佳
     *
     * 註: 主鍵欄位取自opt.pk，預設為id，支援由呼叫端指定
     * 註: 主鍵未命中或主鍵值無效皆回傳null而不reject，[命中]之判定基準與insert、save、del內對既有數據之認定一致
     * 註: 主鍵值依主鍵欄型別正規化後查詢: 字串類主鍵欄之有限數字以String(v)處置(selectByPk(123)即查'123'), 整數類主鍵欄之標準整數寫法字串轉為數值;
     * 型別不符(整數類主鍵欄給'012'、12.4、'abc'等)亦屬主鍵值無效而回傳null
     * 註: 本函數不得有副作用，故不創建資料表
     *
     * @memberOf WOrmReladb
     * @param {String|Number} pk 輸入主鍵值，即數據內opt.pk欄位之值
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳數據物件，若無此主鍵或主鍵值無效則回傳null，reject回傳錯誤訊息
     */
    async function selectByPk(pk, option = {}) {

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check, 實例已關閉之判定須先於[主鍵值無效回null], 否則兩者同形而使[已關閉]被誤讀為[查無資料]
        try {
            procClosed(instance)
        }
        catch (err) {
            emitError('selectByPk', null, err)
            return Promise.reject(err)
        }

        //check, 未給有效主鍵值視為查無數據, 不送查詢以免無效值被轉為null而誤中其他數據
        if (!isEffPk(pk)) {
            return null
        }

        //check
        if (opt.useEncryption && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //isErr, res
        let isErr = false
        let res = null

        //si
        let si = instance

        try {

            //check, 實例已關閉屬整批性錯誤, 於入口快速失敗
            procClosed(instance)

            //initSequelize, 內部自動初始化須在try內: 其例外(如驅動缺失)與si.err同屬整批性錯誤, 方能於reject前發出error事件, 已建構之sequelize亦由finally關閉
            if (instance === null) {
                si = await initSequelize()
            }

            //check
            if (si.err) {
                throw si.err
            }

            //md
            let md = si.mds[opt.cl]

            //normPkOf, 依主鍵欄型別正規化, 型別不符即主鍵值無效而回null且不送查詢(送出時兩方言皆會把整數欄之'012'轉為12而命中)
            let r = normPkOf(md, pk)
            if (r.kind !== 'ok') {
                res = null
            }
            else {

                //setting
                let setting = {
                    where: { [opt.pk]: r.v },
                    raw: true,
                }
                if (transaction !== null) {
                    setting.transaction = transaction
                }

                //findOne
                let v = await md.findOne(setting)

                //check, 判定基準與insert、save、del內對既有數據之認定一致
                if (iseobj(v)) {
                    res = v
                }
                else {
                    //不存在主鍵, 回傳null
                    res = null
                }

            }

        }
        catch (err) {
            isErr = true
            res = err
        }
        finally {

            //closeSequelize
            if (instance === null) { //內部自動初始化得close
                await closeSequelize('selectByPk')
            }

        }

        //check
        if (isErr) {
            emitError('selectByPk', null, res)
            return Promise.reject(res)
        }

        return res
    }


    /**
     * 插入數據，僅於主鍵不存在時寫入，已存在者跳過且不覆寫
     *
     * 由資料庫於主鍵之唯一約束上原子完成[檢查主鍵不存在]與[寫入]，併發時同一主鍵僅有一次成功
     *
     * 註: n為輸入筆數即本次嘗試插入之基準，nInserted為實際插入筆數，全數已存在而nInserted為0屬正常結果
     * 註: 同批含重複主鍵時僅首筆計入nInserted，其餘視為已存在
     * 註: opt.autoGenPk為true(預設)時未帶有效主鍵者自動產生，為false時未帶有效主鍵即reject且同批皆不寫入
     * 註: 主鍵值依主鍵欄型別正規化後寫入(字串類主鍵欄之123存為'123')；型別不符(整數類主鍵欄給'012'等)即reject且同批皆不寫入，不以自動產生之主鍵取代
     * 註: option.returnList開啟時改回與輸入等長且保序之逐筆結果陣列[{n,nInserted,ok}]，
     * 聚合計數只答得出[有幾筆是新的]而答不出[是哪幾筆]，而後者正是去重之產出物；
     * 逐筆元素之n與ok恆為1，資訊由nInserted承載，不變式為
     * 陣列長度等於輸入筆數且filter(v => v.nInserted === 1).length等於聚合模式之nInserted
     *
     * @memberOf WOrmReladb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @param {Boolean} [option.returnList=false] 輸入是否改回逐筆結果陣列布林值，預設false
     * @returns {Promise} 回傳Promise，resolve回傳插入結果{n,nInserted,ok}，或於returnList開啟時回傳[{n,nInserted,ok}]，reject回傳錯誤訊息
     */
    async function insert(data, option = {}) {

        //returnList, 回傳形式之切換為靜態, 僅由本選項之取值決定, 不因數據內容或執行結果而變
        let returnList = get(option, 'returnList', false) === true

        //check
        if (!iseobj(data) && !isearr(data)) {
            if (returnList) {
                return []
            }
            return {
                n: 0,
                nInserted: 0,
                ok: 1,
            }
        }

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useEncryption && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //cloneDeep
        data = cloneDeep(data)

        //isErr, res
        let isErr = false
        let res = null

        //si
        let si = instance

        try {

            //check, 實例已關閉屬整批性錯誤, 於入口快速失敗
            procClosed(instance)

            //initSequelize, 內部自動初始化須在try內: 其例外(如驅動缺失)與si.err同屬整批性錯誤, 方能於reject前發出error事件, 已建構之sequelize亦由finally關閉
            if (instance === null) {
                si = await initSequelize()
            }

            //check
            if (si.err) {
                throw si.err
            }

            //md
            let md = si.mds[opt.cl]

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //procPk, 須於任何寫入之前一次完成, 令autoGenPk為false而拋錯時同批之有效筆數亦不會被寫入
            data = map(data, (v, k) => {
                return procPk(md, v, k)
            })

            //normPks, 主鍵值依主鍵欄型別正規化後寫回, 型別不符者整批reject且不寫入任何一筆, 令insert對既有數據之認定與selectByPk一致
            normPks(md, data)

            //nAll, n之基準為輸入筆數
            let nAll = size(data)

            //setting
            let setting = { }
            if (transaction !== null) {
                setting.transaction = transaction
            }

            //create, 逐筆插入以取得精確之nInserted
            //註: 不採bulkCreate配合ignoreDuplicates, 因mssql未宣告該能力而選項會被靜默忽略仍撞唯一約束,
            //且bulkCreate無從回報實際插入筆數; 單筆INSERT本即由主鍵之唯一約束原子完成檢查與寫入
            //註: bIns即逐筆判定, 與輸入等長且保序, 供returnList直接包裝而不須另行推導
            let bInss = await pmSeries(data, async(v) => {

                //bIns, 撞既有主鍵者視為已存在而跳過, 其餘錯誤影響全部數據須往外拋
                let bIns = await md.create(v, setting)
                    .then(() => {
                        return true
                    })
                    .catch((err) => {
                        if (isDupPkError(err)) {
                            return false
                        }
                        throw err
                    })

                return bIns
            })

            if (returnList) {

                //res, 與輸入等長且保序之逐筆結果; 各筆之n恆為1(該筆主鍵或為命中既有或經插入而產生),
                //ok恆為1(insert之任何錯誤皆屬整批性錯誤而reject), 資訊由nInserted承載
                res = map(bInss, (bIns) => {
                    return {
                        n: 1,
                        nInserted: bIns ? 1 : 0,
                        ok: 1,
                    }
                })

            }
            else {

                //res, 全數已存在而nInserted為0屬正常結果, 不視為錯誤
                res = {
                    n: nAll,
                    nInserted: size(bInss.filter((v) => v === true)),
                    ok: 1,
                }

            }

        }
        catch (err) {
            isErr = true
            res = err
        }
        finally {

            //closeSequelize
            if (instance === null) { //內部自動初始化得close
                await closeSequelize('insert')
            }

        }

        //check
        if (isErr) {
            emitError('insert', data, res)
            return Promise.reject(res)
        }

        //emit, 須於結果定案後發出
        emitChange('insert', data, res)

        return res
    }


    /**
     * 批次插入數據，全批視為一個單位：全部插入成功，或一筆都不寫入
     *
     * 本函數非insert之加速版，兩者衝突政策不同：insert於主鍵已存在時跳過該筆且整批ok為1，
     * 本函數則整批reject且不寫入任何一筆，同批含重複主鍵者亦視為衝突。
     * 確無衝突時兩者之可觀察結果完全相同，差異僅於有衝突時顯現。
     *
     * 註: n為輸入筆數即本次嘗試插入之基準；nInserted於成功時恆等於n，雖無額外資訊仍保留，
     * 令呼叫端得與insert共用同一段結果處理程式碼
     * 註: 不提供逐筆結果，故不出現ok為0與err；需要逐筆處置者改用insert
     * 註: opt.autoGenPk為true(預設)時未帶有效主鍵者自動產生，為false時未帶有效主鍵即reject且同批皆不寫入
     * 註: 主鍵值依主鍵欄型別正規化後寫入(字串類主鍵欄之123存為'123')；型別不符(整數類主鍵欄給'012'等)即reject且同批皆不寫入
     * 註: [全有全無]為獨立於T7之額外要求——T7僅保證每筆之[檢查主鍵不存在]與[寫入]為原子，不保證整批。
     * mssql因綁定參數數量上限會由驅動層自動拆為多語句送出，實測1000筆之批次於末筆撞主鍵時已有946筆落盤，
     * 故一律以交易包覆並於失敗時回滾；呼叫端已給transaction時改以巢狀交易(SAVEPOINT)包覆，
     * 令回滾範圍限於本次呼叫而不影響呼叫端交易內先前之寫入
     *
     * @memberOf WOrmReladb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳插入結果{n,nInserted,ok}，reject回傳錯誤訊息
     */
    async function insertBulk(data, option = {}) {

        //check
        if (!iseobj(data) && !isearr(data)) {
            return {
                n: 0,
                nInserted: 0,
                ok: 1,
            }
        }

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useEncryption && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //cloneDeep
        data = cloneDeep(data)

        //isErr, res
        let isErr = false
        let res = null

        //si
        let si = instance

        try {

            //check, 實例已關閉屬整批性錯誤, 於入口快速失敗
            procClosed(instance)

            //initSequelize, 內部自動初始化須在try內: 其例外(如驅動缺失)與si.err同屬整批性錯誤, 方能於reject前發出error事件, 已建構之sequelize亦由finally關閉
            if (instance === null) {
                si = await initSequelize()
            }

            //check
            if (si.err) {
                throw si.err
            }

            //md
            let md = si.mds[opt.cl]

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //procPk, 須於任何寫入之前一次完成, 令autoGenPk為false而拋錯時同批皆不會被寫入
            data = map(data, (v, k) => {
                return procPk(md, v, k)
            })

            //normPks, 主鍵值依主鍵欄型別正規化後寫回, 型別不符者整批reject且不寫入任何一筆
            normPks(md, data)

            //nAll, n之基準為輸入筆數
            let nAll = size(data)

            //useTx, sqlcipher不支援transaction, 該情形下改倚賴sqlite單一語句之原子性
            let useTx = !(opt.useEncryption && dialect === 'sqlite')

            //t, 呼叫端未給交易時自開; 已給時以巢狀交易(SAVEPOINT)包覆令回滾範圍限於本次呼叫
            let t = null
            if (useTx) {
                t = (transaction !== null)
                    ? await md.sequelize.transaction({ transaction })
                    : await md.sequelize.transaction()
            }

            //setting
            let setting = {}
            if (t !== null) {
                setting.transaction = t
            }
            else if (transaction !== null) {
                setting.transaction = transaction
            }

            try {

                //bulkCreate, 未加任何跳過選項, 故任一筆撞主鍵即整句失敗, 同批重複主鍵亦於此被偵測為衝突
                await md.bulkCreate(data, setting)

                if (t !== null) {
                    await t.commit()
                }

            }
            catch (err) {
                if (t !== null) {
                    await t.rollback().catch(() => {})
                }
                throw err
            }

            //res, 全有全無故成功時nInserted恆等於n
            res = {
                n: nAll,
                nInserted: nAll,
                ok: 1,
            }

        }
        catch (err) {
            isErr = true
            res = err
        }
        finally {

            //closeSequelize
            if (instance === null) { //內部自動初始化得close
                await closeSequelize('insertBulk')
            }

        }

        //check
        if (isErr) {
            emitError('insertBulk', data, res)
            return Promise.reject(res)
        }

        //emit, 須於結果定案後發出
        emitChange('insertBulk', data, res)

        return res
    }


    /**
     * 儲存單筆數據
     *
     * 採條件寫入配合衝突偵測與重試: 每次寫入本身為單一條件式原子語句——插入由主鍵之唯一約束判定、
     * 更新由WHERE主鍵之比對判定，皆非由預讀值決定其成敗；預讀僅用於選擇發出哪一條語句，
     * 選錯不會產生錯誤結果，只會被偵測並重試(插入撞既有主鍵、更新未命中任何列)，故縱使預讀值已過期，
     * 最終結果仍與該次操作單獨執行時相同。
     * 註: 不採sequelize之upsert，因sqlite無從於單一語句內回報本次係插入或更新(其created恆為null)，
     * 而insert與save之規格要求nInserted精確，兩者於sqlite互斥，故改採本形式
     * 註: [內容相同]之判定基準為將待寫入物件合併進現值後與現值相同，相同則不寫入而nModified為0，
     * 合併取淺層以與後端整欄取代之寫入行為一致，令nModified忠實反映資料庫端是否真的寫入
     *
     * @ignore
     * @param {Object} md 輸入資料表model物件
     * @param {Object} v 輸入數據物件
     * @param {Boolean} autoInsert 輸入是否於查無數據時自動改以插入處理布林值
     * @param {Object|null} transaction 輸入交易(transaction)物件
     * @param {Array} ks 輸入model之欄位名陣列
     * @returns {Promise} 回傳Promise，resolve回傳本筆儲存結果，本筆失敗時亦resolve並以ok為0回報
     */
    async function saveOne(md, v, autoInsert, transaction, ks) {

        //nTry, 預測錯誤時重試, 給予有限次數令其收斂
        let nTry = 3

        //rest
        let rest = null

        //inserted, 供結果定案後發出insert事件用
        let inserted = false

        //pkv
        let pkv = get(v, opt.pk)

        //setting
        let settingRead = {
            where: { [opt.pk]: pkv },
            raw: true,
        }
        let settingUpd = {
            where: { [opt.pk]: pkv },
        }
        let settingIns = {}
        if (transaction !== null) {
            settingRead.transaction = transaction
            settingUpd.transaction = transaction
            settingIns.transaction = transaction
        }

        for (let i = 0; i < nTry; i++) {

            try {

                //預讀, 供判斷內容是否相同之快速路徑, 其結果不用於決定寫入內容
                let _v = await md.findOne(settingRead)

                if (iseobj(_v)) {
                    //主鍵存在

                    //_vt, vt, 以待寫入物件之非主鍵欄位淺層覆蓋現值後與現值比對
                    let _vt = omit(_v, opt.pk)
                    let vt = {
                        ..._vt,
                        ...pick(omit(v, opt.pk), ks),
                    }

                    //check, 內容相同者不寫入
                    if (isEqual(vt, _vt)) {
                        rest = {
                            n: 1,
                            nInserted: 0,
                            nModified: 0,
                            ok: 1,
                        }
                        break
                    }

                    //update, 單一UPDATE語句由WHERE主鍵原子完成查找與更新
                    let rr = await md.update(v, settingUpd)
                    let nAff = get(rr, 0, 0)

                    if (nAff > 0) {
                        rest = {
                            n: 1,
                            nInserted: 0,
                            nModified: 1,
                            ok: 1,
                        }
                        break
                    }

                    //該列已被他方刪除, 重試改走插入
                    continue
                }

                //主鍵不存在且未開啟autoInsert則不寫入以免無中生有
                if (!autoInsert) {
                    rest = {
                        n: 0,
                        nInserted: 0,
                        nModified: 0,
                        ok: 1,
                    }
                    break
                }

                //create, 單一INSERT語句由主鍵之唯一約束原子完成檢查與寫入
                let bIns = await md.create(v, settingIns)
                    .then(() => {
                        return true
                    })
                    .catch((err) => {
                        if (isDupPkError(err)) {
                            return false
                        }
                        throw err
                    })

                if (bIns) {
                    rest = {
                        n: 1,
                        nInserted: 1,
                        nModified: 0,
                        ok: 1,
                    }
                    inserted = true
                    break
                }

                //他方已插入同一主鍵, 重試改走更新
                continue
            }
            catch (err) {

                //check, 連線層錯誤影響後續所有筆數, 依T4屬整批性錯誤, 往外拋而不降為本筆ok為0
                if (isBatchLevelError(err)) {
                    throw err
                }

                //其餘錯誤視為本筆失敗, 不中斷整批, 由呼叫端以ok與err判讀
                rest = {
                    n: 1,
                    nInserted: 0,
                    nModified: 0,
                    ok: 0,
                    err: getErrMsg(err),
                }
                break
            }

        }

        //check, 重試耗盡仍未定案
        if (rest === null) {
            rest = {
                n: 1,
                nInserted: 0,
                nModified: 0,
                ok: 0,
                err: `can not save data by ${opt.pk}[${pkv}] in ${nTry} tries`,
            }
        }

        //emit, 須於本筆結果定案後發出, 避免訂閱函數拋錯影響本筆結果
        if (inserted) {
            emitChange('insert', [v], rest)
        }
        if (rest.ok === 0) {
            emitError('save', [v], rest.err)
        }

        return rest
    }


    /**
     * 儲存數據，以主鍵為準更新既有數據，未給之欄位保留；主鍵不存在且option.autoInsert為true(預設)時改為插入
     *
     * 註: 回傳陣列恆與輸入等長，輸入單一物件亦回傳長度1之陣列
     * 註: n為主鍵命中筆數，值為0或1，命中(不論內容有無變更)或經插入而產生皆為1；nInserted與nModified恆同時出現
     * 註: [內容相同]之判定基準為將待寫入物件合併進現值後與現值相同，非待寫入物件與現值全等，
     * 故只給部份欄位且該些欄位值皆與現值相同時，合併結果等於現值，nModified為0
     * 註: 本筆失敗不中斷整批，該筆以ok為0並附err回報
     * 註: opt.autoGenPk為true(預設)時未帶有效主鍵者自動產生，為false時未帶有效主鍵即reject且同批皆不寫入
     * 註: 主鍵值依主鍵欄型別正規化(字串類主鍵欄之123即'123')；型別不符(整數類主鍵欄給'012'等)屬呼叫端未履行契約，整批reject且同批皆不寫入
     *
     * @memberOf WOrmReladb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @param {boolean} [option.autoInsert=true] 輸入是否於儲存時發現原本無數據，則自動改以插入處理，預設為true
     * @returns {Promise} 回傳Promise，resolve回傳與輸入等長之儲存結果陣列[{n,nInserted,nModified,ok}]，reject回傳錯誤訊息
     */
    async function save(data, option = {}) {

        //check
        if (!iseobj(data) && !isearr(data)) {
            return []
        }

        //cloneDeep
        data = cloneDeep(data)

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useEncryption && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //autoInsert
        let autoInsert = get(option, 'autoInsert', true)

        //isErr, res
        let isErr = false
        let res = null

        //si
        let si = instance

        try {

            //check, 實例已關閉屬整批性錯誤, 於入口快速失敗
            procClosed(instance)

            //initSequelize, 內部自動初始化須在try內: 其例外(如驅動缺失)與si.err同屬整批性錯誤, 方能於reject前發出error事件, 已建構之sequelize亦由finally關閉
            if (instance === null) {
                si = await initSequelize()
            }

            //check
            if (si.err) {
                throw si.err
            }

            //md
            let md = si.mds[opt.cl]

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //procPk, 須於任何寫入之前一次完成, 令autoGenPk為false而拋錯時同批之有效筆數亦不會被寫入
            data = map(data, (v, k) => {
                return procPk(md, v, k)
            })

            //normPks, 主鍵值依主鍵欄型別正規化後寫回, 型別不符者整批reject且不寫入任何一筆
            normPks(md, data)

            //ks, model之欄位名, 供合併後比對時濾除非欄位之鍵
            let ks = keys(get(md, 'rawAttributes', {}))

            //pmSeries
            res = await pmSeries(data, async(v) => {
                return saveOne(md, v, autoInsert, transaction, ks)
            })

        }
        catch (err) {
            isErr = true
            res = err
        }
        finally {

            //closeSequelize
            if (instance === null) { //內部自動初始化得close
                await closeSequelize('save')
            }

        }

        //check
        if (isErr) {
            emitError('save', data, res)
            return Promise.reject(res)
        }

        //emit, 須於結果定案後發出
        emitChange('save', data, res)

        return res
    }


    /**
     * 刪除數據
     *
     * 註: 回傳陣列恆與輸入等長，各筆之n與nDeleted皆為主鍵命中筆數，值為0或1，未命中為0且屬正常結果
     * 註: 判斷某筆是否真的被刪除一律以nDeleted為準
     * 註: 未帶有效主鍵者為該筆之輸入問題，回ok為0與err且不送查詢條件(以免無效值被轉為null而誤中其他數據)，
     * 不中斷其餘筆數，以此與[主鍵未命中]之ok為1區辨；主鍵值與主鍵欄型別不符者(整數類主鍵欄給'012'等)亦同
     * 註: 主鍵值依主鍵欄型別正規化後刪除(字串類主鍵欄之123即'123')，正規化值寫回該筆數據
     * 註: 本函數不受opt.autoGenPk影響，於任一設定下皆不補值
     *
     * @memberOf WOrmReladb
     * @param {Object|Array} data 輸入數據物件或陣列，會查找各數據的opt.pk值，有存在者就刪除
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳與輸入等長之刪除結果陣列[{n,nDeleted,ok}]，reject回傳錯誤訊息
     */
    async function del(data, option = {}) {

        //check
        if (!iseobj(data) && !isearr(data)) {
            return []
        }

        //cloneDeep
        data = cloneDeep(data)

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useEncryption && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //isErr, res
        let isErr = false
        let res = null

        //si
        let si = instance

        try {

            //check, 實例已關閉屬整批性錯誤, 於入口快速失敗
            procClosed(instance)

            //initSequelize, 內部自動初始化須在try內: 其例外(如驅動缺失)與si.err同屬整批性錯誤, 方能於reject前發出error事件, 已建構之sequelize亦由finally關閉
            if (instance === null) {
                si = await initSequelize()
            }

            //check
            if (si.err) {
                throw si.err
            }

            //md
            let md = si.mds[opt.cl]

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //pmSeries
            res = await pmSeries(data, async(v) => {

                //rest
                let rest = null

                //pkv
                let pkv = get(v, opt.pk)

                //check, 未帶有效主鍵者不補值亦不送查詢, 直接視為該筆無法處理
                if (!isEffPk(pkv)) {

                    //rest
                    rest = {
                        n: 0,
                        nDeleted: 0,
                        ok: 0,
                        err: `invalid ${opt.pk}[${pkv}]`,
                    }

                    //emit
                    emitError('del', [v], rest.err)

                    return rest
                }

                //normPkOf, 主鍵值與主鍵欄型別不符亦屬未帶有效主鍵, 不送查詢(送出時兩方言皆會把整數欄之'012'轉為12而誤刪)
                let r = normPkOf(md, pkv)
                if (r.kind !== 'ok') {

                    //rest
                    rest = {
                        n: 0,
                        nDeleted: 0,
                        ok: 0,
                        err: `invalid ${opt.pk}[${pkv}], type does not match pk column`,
                    }

                    //emit
                    emitError('del', [v], rest.err)

                    return rest
                }

                //寫回正規化值, 令事件之數據與實際送出者一致
                v[opt.pk] = r.v

                //setting
                let setting = {
                    where: { [opt.pk]: r.v },
                }
                if (transaction !== null) {
                    setting.transaction = transaction //destroy的說明寫不需transaction但實際需要 (2020/10/07)
                }

                //destroy, 單一DELETE語句即可取得命中筆數, 不另行findOne以免多一次往返且與刪除間存在競態
                await md.destroy(setting)
                    .then((r) => {

                        //nDel, n與nDeleted皆為主鍵命中筆數, 未命中為0且屬正常結果
                        let nDel = isnum(r) ? r : 0

                        //rest
                        rest = {
                            n: nDel,
                            nDeleted: nDel,
                            ok: 1,
                        }

                    })
                    .catch((err) => {

                        //check, 連線層錯誤影響後續所有筆數, 依T4屬整批性錯誤, 往外拋而不降為本筆ok為0
                        if (isBatchLevelError(err)) {
                            throw err
                        }

                        //rest, 本筆失敗不中斷整批
                        rest = {
                            n: 1,
                            nDeleted: 0,
                            ok: 0,
                            err: getErrMsg(err),
                        }

                        //emit
                        emitError('del', [v], rest.err)

                    })

                return rest
            })

        }
        catch (err) {
            isErr = true
            res = err
        }
        finally {

            //closeSequelize
            if (instance === null) { //內部自動初始化得close
                await closeSequelize('del')
            }

        }

        //check
        if (isErr) {
            emitError('del', data, res)
            return Promise.reject(res)
        }

        //emit, 須於結果定案後發出
        emitChange('del', data, res)

        return res
    }


    /**
     * 依條件刪除多筆數據(破壞性操作, 須審慎使用, 非必要不用; 刪除單筆請用del), 需與del分開，避免未傳數據導致直接刪除全表
     *
     * 使用須知:
     * 1. 不給條件即刪除全部數據: find未給、為undefined或為{}時, 刪除資料表內全部數據, 不另行確認。給了條件才是部分刪除。
     * 2. 傳了值卻不是條件物件(null、陣列含[]與[{...}]、字串、數值、布林、函數、Date、RegExp、Map、Set、類別實例等)
     *    一律整批reject, 不視為{}, 不刪除任何數據。
     * 3. 條件僅支援系列白名單: 欄位等值{欄:純量}(多欄為AND)、欄位運算子$eq $ne $gt $gte $lt $lte(值為純量)與
     *    $in $nin(值為純量陣列)、文件層$and $or(值為條件物件之非空陣列, 最多999項)。純量為字串、有限數字、布林、有效Date;
     *    null僅可用於欄位等值、$eq、$ne。白名單外之運算子($not $nor $regex $options $exists $where $expr $like $ilike等)、
     *    sequelize之Op Symbol、RegExp值、陣列值(請改用$in)、欄位層$and/$or、子查詢、函數值、Symbol鍵、undefined值、
     *    空的$nin/$and/$or等一律整批reject, 訊息為invalid find: 原因 at [路徑], 且不刪除任何數據。
     * 4. 與select共用同一檢核與同一條件, select(find)命中之數據即本函數刪除之數據; 建議先以select(find)確認命中範圍再刪除。
     *    欄名須完全等於model之屬性名或資料庫欄名(區分大小寫); 純量須符合欄位型別; 主鍵欄之條件值依主鍵欄型別正規化。
     * 5. 條件值若來自可能為undefined、null或空陣列之變數, 呼叫端須先自行判斷; undefined值會reject而非被忽略,
     *    空的$nin會reject, $in:[]則為恆假(刪除0筆)。
     * 6. 語意差異(SQL式): $ne/$nin不命中欄位為NULL之數據(三值邏輯)。需明確表達時可用可攜寫法:
     *    排除NULL為{$and:[{f:{$ne:null}},{f:{$ne:x}}]}, 含NULL為{$or:[{f:null},{f:{$ne:x}}]}; 字串比對之大小寫依資料庫定序。
     *
     * 註: n與nDeleted皆為實際刪除筆數，兩者恆相等，n不得取全表筆數
     * 註: 條件無命中時回{n:0,nDeleted:0,ok:1}，不視為錯誤
     *
     * @memberOf WOrmReladb
     * @param {Object} [find={}] 輸入刪除條件物件(系列白名單, 見使用須知)，不給予find則代表刪除全部數據
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳刪除結果{n,nDeleted,ok}，reject回傳錯誤訊息
     */
    async function delAll(find = {}, option = {}) {

        //instance
        let instance = get(option, 'instance', null)

        //transaction
        let transaction = get(option, 'transaction', null)

        //check
        if (opt.useEncryption && dialect === 'sqlite') {
            if (transaction !== null) {
                console.log('@journeyapps/sqlcipher can not support transaction.')
            }
        }

        //isErr, res
        let isErr = false
        let res = null

        //si
        let si = instance

        //inited, 本次呼叫是否已進入initSequelize(僅此時finally才關閉sequelize; 預檢失敗於其前者不得關閉呼叫端先前持有之連線)
        let inited = false

        try {

            //check, 實例已關閉屬整批性錯誤, 於入口快速失敗
            procClosed(instance)

            //chkFindShape, 條件形狀不合法者(系列白名單, R11)於載入model與建立sequelize實例之前即拋錯: 不連線、不送出任何SQL、不刪除任何數據; 其後只使用檢核後之複本
            let fd = chkFindShape(find)

            //initSequelize, 內部自動初始化須在try內: 其例外(如驅動缺失)與si.err同屬整批性錯誤, 方能於reject前發出error事件, 已建構之sequelize亦由finally關閉
            if (instance === null) {
                inited = true
                si = await initSequelize()
            }

            //check
            if (si.err) {
                throw si.err
            }

            //md
            let md = si.mds[opt.cl]

            //useFind, 與select共用cvFind(對複本再檢核一次, 冪等), 令刪除之數據即select命中之數據; 翻譯層不合法者於此拋錯而不刪除任何數據
            let useFind = cvFind(fd, getFindCtx(md))

            //chkScopeForDelAll, model之預設scope會使刪除對象與select分歧者拒絕
            chkScopeForDelAll(md)

            //setting
            let setting = {
                where: useFind,
            }
            if (transaction !== null) {
                setting.transaction = transaction //destroy的說明寫不需transaction但實際需要 (2020/10/07)
            }

            //destroy, n與nDeleted皆為實際刪除筆數, 條件無命中時為0且屬正常結果
            let r = await md.destroy(setting)
            let nDel = isnum(r) ? r : 0

            //res
            res = {
                n: nDel,
                nDeleted: nDel,
                ok: 1,
            }

        }
        catch (err) {
            isErr = true
            res = err
        }
        finally {

            //closeSequelize
            if (instance === null && inited) { //內部自動初始化得close
                await closeSequelize('delAll')
            }

        }

        //check
        if (isErr) {
            emitError('delAll', null, res)
            return Promise.reject(res)
        }

        //emit, 須於結果定案後發出
        emitChange('delAll', null, res)

        return res
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
     * 目前僅能產生js檔格式，且mssql欄位為nvarchar(MAX)無法自動轉成TEXT格式
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
     * @param {Object} [tabs={}] 輸入各資料表物件，預設{}
     * @param {Object} [opt={}] 輸入設定物件，預設{}
     * @param {String} [opt.type='js'] 輸入資料表類型字串，預設'js'
     */
    function genModelsByTabs(...input) {
        _genModelsByTabs(...input)
    }


    //bind
    ee.createStorage = createStorage
    ee.genModelsByDB = genModelsByDB
    ee.genModelsByTabs = genModelsByTabs
    ee.init = initSequelize
    // ee.close = () => {
    //     return closeSequelize('external')
    // }
    ee.genTransaction = genTransaction
    if (opt.useStable) {
        //用佇列(同時最大執行數1且先進先執行)處理高併發之情形
        //若沒管控:
        //mssql就是先執行先贏
        //Sqlite有機會無法儲存, 或是出錯[Error: SQLITE_MISUSE: bad parameter or other API misuse]或[Error: SQLITE_MISUSE: Database handle is closed]
        ee.select = function() {
            return pmq(select, ...arguments)
        }
        ee.selectByPk = function() {
            return pmq(selectByPk, ...arguments)
        }
        ee.insert = function() {
            return pmq(insert, ...arguments)
        }
        ee.insertBulk = function() {
            return pmq(insertBulk, ...arguments)
        }
        ee.save = function() {
            return pmq(save, ...arguments)
        }
        ee.del = function() {
            return pmq(del, ...arguments)
        }
        ee.delAll = function() {
            return pmq(delAll, ...arguments)
        }
    }
    else {
        ee.select = select
        ee.selectByPk = selectByPk
        ee.insert = insert
        ee.insertBulk = insertBulk
        ee.save = save
        ee.del = del
        ee.delAll = delAll
    }

    return ee
}


export default WOrmReladb
