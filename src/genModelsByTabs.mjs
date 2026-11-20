import fs from 'fs'
import JSON5 from 'json5'
import each from 'lodash-es/each.js'
import get from 'lodash-es/get.js'
import replace from 'wsemi/src/replace.mjs'
import strright from 'wsemi/src/strright.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import chkReadable from 'wsemi/src/chkReadable.mjs'
import getDiag from 'wsemi/src/getDiag.mjs'


//SAFE_KEYS, 本模組診斷摘要safe用到之鍵(errType與errCode由wsemi恆含): name(表名)、type(檔案類型js或json)
const SAFE_KEYS = ['name', 'type']


//assertReadable, 呼叫端給的值經判斷函數(isestr、iseobj)判為無效後之可讀性探針(第557項, R23): 值不可讀(讀取即拋錯, 經wsemi之chkReadable判定)者同步throw固定詞彙invalid <名稱>: must be a readable value
//(本函數無整批reject通道, 其錯誤皆為同步拋出, 如fsCreateFolder失敗), 不被當成型別不符而改用預設或當成型別字串寫入models檔; 可讀而型別不符者回傳(照既有行為); 探針只置於判斷函數回false之後, 有效輸入不多讀
//opt.ownKeys為true者(iseobj之判定: for...in讀取自有鍵與原型鏈, 陷阱拋錯者iseobj回false)多探自有鍵
let assertReadable = (v, name, o = {}) => {
    if (chkReadable(v, o) !== '') {
        throw new Error(`invalid ${name}: must be a readable value`)
    }
}


let fieldsAll = {} //Sequelize Datatypes: https://sequelize.org/v5/manual/data-types.html

function getField(type, pk = false, diag) {

    //add type
    fieldsAll[type] = true

    //o
    let o = {
        type: `DataTypes.${type}`,
        primaryKey: false,
        allowNull: true,
        autoIncrement: false,
        comment: null
    }

    //check
    if (pk) {
        o.primaryKey = true
        o.allowNull = false
    }

    //check
    if (o.primaryKey && o.type === 'TEXT') {
        diag(`Can not use TEXT type for primary key. It will change type to STRING automatically.`)
        o.type = `DataTypes.STRING` //STRING => VARCHAR(255)
    }

    return o
}

//getEntries, 取各鍵值對之快照(只讀取, 不處理): 讀取即拋錯者(已撤銷之Proxy、ownKeys陷阱、存取器拋錯)於此讀取處捕捉並轉固定詞彙invalid tabs(R23, 共同規則四.2: 拋出之文字由呼叫端之物件決定, 不外帶);
//其後只使用快照(檢查之值即使用之值)
let getEntries = (obj) => {
    let es = []
    try {
        each(obj, (v, k) => {
            es.push([k, v])
        })
    }
    catch (err) {
        throw new Error('invalid tabs: must be a readable value')
    }
    return es
}

//normFields, 讀取並正規化某表之各欄位型別(快照): 回傳[[欄名, 型別, 是否主鍵], ...];
//讀取即拋錯或不可讀者(欄位型別描述物件之成員為存取器而拋錯、型別值為已撤銷之Proxy等)同步throw固定詞彙invalid tabs, 不當成型別字串寫入models檔(R23);
//全部資料表於寫出任何檔案之前先正規化, 失敗時不留下部分產出
function normFields(kpType) {
    let list = []
    for (let [k, t] of getEntries(kpType)) {
        let pk = false
        if (iseobj(t)) {
            try {
                pk = get(t, 'pk', false)
                let _t = get(t, 'type', null)
                if (_t) {
                    t = _t
                }
            }
            catch (err) {
                throw new Error('invalid tabs: must be a readable value') //欄位型別描述物件之成員為存取器而拋錯(R23, 共同規則四.2)
            }
        }
        else {
            assertReadable(t, 'tabs', { ownKeys: true }) //欄位型別(tabs之成員)不可讀者不當成型別字串寫入models檔(R23)
        }
        list.push([k, t, pk])
    }
    return list
}

function getFields(norm, diag) {
    let fields = {}
    for (let [k, t, pk] of norm) {
        fields[k] = getField(t, pk, diag)
    }
    return fields
}

function getJsonModel(name, kpType, diag) {

    let tmp = `
    {
        table: '{name}',
        fields: {fields}, 
        options: {
            tableName: '{name}'
        }
    }
    `

    let f = getFields(kpType, diag)
    let fields = JSON.stringify(f, null, 4)

    tmp = replace(tmp, '{name}', name)
    tmp = replace(tmp, '{fields}', fields)
    //不能取代否則無法format(JSON5.parse), 之後於importModels會使用readJsonModel自動轉換並繫結

    //format
    tmp = JSON5.stringify(JSON5.parse(tmp), null, 4)

    return tmp
}

function getJsModel(name, kpType, diag) {

    let tmp = `module.exports = function(sequelize, DataTypes) {
    return sequelize.define('{name}', {fields}, {
        tableName: '{name}'
    });
};
    `

    let f = getFields(kpType, diag)
    let fields = JSON.stringify(f, null, 4)

    tmp = replace(tmp, '{name}', name)
    tmp = replace(tmp, '{fields}', fields)
    each(fieldsAll, (v, field) => {
        tmp = replace(tmp, `"DataTypes.${field}"`, `DataTypes.${field}`)
    })

    return tmp
}

/**
 * 由資料表物件生成各資料表的models檔
 *
 * 診斷輸出經第4參數diag(跨套件契約, dspec〈診斷輸出與遮罩〉設計§6.7第6條)：diag須為wsemi之getDiag所回傳之實例(函數且帶brief方法)，由呼叫端以其設定(logDetail、funLog、秘密與safeKeys)建立；
 * 本函數只以下列固定標籤呼叫diag(label, safe, getDetail)與diag.brief(err)，不以呼叫端之值組成label：
 * 'generate file:'(safe為{ name, type }，細節為檔案路徑)、'save file catch'(safe為{ name, type, errType, errCode }，細節為寫檔之錯誤)、
 * 'Can not use TEXT type for primary key. It will change type to STRING automatically.'(無safe)；safe之name為表名、type為'js'或'json'，呼叫端之safeKeys須含'name'、'type'方能保留之(白名單外之鍵由wsemi丟棄)
 * 未給或不合契約者(非函數或無brief)改用本模組之預設出口(wsemi之getDiag，console只輸出固定標籤與摘要，不輸出細節)；寫檔失敗只記錄、不拋錯
 *
 * fd、tabs、tabs內之欄位型別與opt不可讀(已撤銷之Proxy、Symbol.toStringTag或ownKeys陷阱拋錯之物件，或成員為存取器而拋錯者)時，於建立資料夾與寫出任何檔案之前同步throw固定詞彙invalid fd、invalid tabs、invalid opt、invalid opt.type: must be a readable value(不含原例外文字；第557項, R23)，
 * 不被當成未給而寫入預設資料夾，亦不把不可讀之值當型別字串寫入models檔；可讀而型別不符者照既有行為
 *
 * @param {String} [fd='./models'] 輸入models儲存的資料夾名稱字串，預設'./models'
 * @param {Object} [tabs={}] 輸入各資料表物件，預設{}
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.type='js'] 輸入資料表類型字串，可有'js'、'json'，預設'js'
 * @param {Function} [diag] 輸入wsemi之getDiag所回傳之診斷輸出實例，預設為本模組之預設出口
 * @returns {undefined} 無回傳值
 */
function genModelsByTabs(fd, tabs, opt = {}, diag) {
    // console.log('genModelsByTabs')

    //diag, 不合契約者用預設出口
    if (typeof diag !== 'function' || typeof diag.brief !== 'function') {
        diag = getDiag(undefined, { safeKeys: SAFE_KEYS })
    }
    // console.log('fd', fd)
    // console.log('tabs', tabs)
    // console.log('opt', opt)

    //fd, 不可讀者(R23)同步throw invalid fd, 不被當成未給而寫入預設資料夾
    if (!isestr(fd)) {
        assertReadable(fd, 'fd')
        fd = './models'
    }

    //tabs, 判斷函數判為無效(含空物件)後分辨不可讀(R23): 不可讀者同步throw invalid tabs, 不被當成空而靜默不產生任何檔案
    if (!iseobj(tabs)) {
        assertReadable(tabs, 'tabs', { ownKeys: true })
    }

    //type, opt容器本身不可讀(讀其成員即拋錯)者同步throw invalid opt, 成員type為存取器而拋錯者同步throw invalid opt.type(R23, 共同規則四.1、四.2; 皆為固定詞彙)
    let type
    try {
        type = get(opt, 'type')
    }
    catch (err) {
        assertReadable(opt, 'opt')
        throw new Error('invalid opt.type: must be a readable value')
    }
    if (type !== 'js' && type !== 'json') {
        type = 'js'
    }
    //console.log('type', type)

    //讀取全部資料表與欄位型別(快照, 含讀取拋錯與不可讀之拒絕)先於建立資料夾與任何寫檔: 失敗時不留下部分產出(R23)
    let tabList = getEntries(tabs).map(([name, kpType]) => [name, normFields(kpType)])

    //fsCreateFolder
    fsCreateFolder(fd)

    //each
    tabList.forEach(([name, kpType]) => {
        //console.log('kpType', kpType, 'name', name)

        //getModel
        let c = null
        if (type === 'js') {
            c = getJsModel(name, kpType, diag)
        }
        else if (type === 'json') {
            c = getJsonModel(name, kpType, diag)
        }
        // console.log('model',c)

        //fn
        if (strright(fd, 1) !== '/') {
            fd = `${fd}/`
        }
        let fn = `${fd}${name}.${type}`
        // console.log('fn', fn)

        //write
        try {
            fs.writeFileSync(fn, c, 'utf8')
            diag('generate file:', { name, type }, () => fn)
        }
        catch (err) {
            diag('save file catch', { name, type, ...diag.brief(err) }, () => err)
        }

    })

}


export default genModelsByTabs
