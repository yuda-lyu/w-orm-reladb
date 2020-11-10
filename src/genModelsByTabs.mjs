import fs from 'fs'
import JSON5 from 'json5'
import each from 'lodash/each'
import get from 'lodash/get'
import replace from 'wsemi/src/replace.mjs'
import strright from 'wsemi/src/strright.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'


let fieldsAll = {} //Sequelize Datatypes: https://sequelize.org/v5/manual/data-types.html

function getField(type, pk = false) {

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
        console.log(`Can not construct TEXT type for primary key. It will change type to STRING automatically.`)
        o.type = `DataTypes.STRING`
    }

    return o
}

function getFields(kpType) {
    let fields = {}
    each(kpType, (t, k) => {
        let pk = false
        if (iseobj(t)) {
            pk = get(t, 'pk', false)
            let _t = get(t, 'type', null)
            if (_t) {
                t = _t
            }
        }
        fields[k] = getField(t, pk)
    })
    return fields
}

function getJsonModel(name, kpType) {

    let tmp = `
    {
        table: '{name}',
        fields: {fields}, 
        options: {
            tableName: '{name}'
        }
    }
    `

    let f = getFields(kpType)
    let fields = JSON.stringify(f, null, 4)

    tmp = replace(tmp, '{name}', name)
    tmp = replace(tmp, '{fields}', fields)
    //不能取代否則無法format(JSON5.parse), 之後於importModels會使用readJsonModel自動轉換並繫結

    //format
    tmp = JSON5.stringify(JSON5.parse(tmp), null, 4)

    return tmp
}

function getJsModel(name, kpType) {

    let tmp = `module.exports = function(sequelize, DataTypes) {
    return sequelize.define('{name}', {fields}, {
        tableName: '{name}'
    });
};
    `

    let f = getFields(kpType)
    let fields = JSON.stringify(f, null, 4)

    tmp = replace(tmp, '{name}', name)
    tmp = replace(tmp, '{fields}', fields)
    each(fieldsAll, (v, field) => {
        tmp = replace(tmp, `"DataTypes.${field}"`, `DataTypes.${field}`)
    })

    return tmp
}

function genModelsByTabs(fd, tabs, opt = {}) {
    // console.log('genModelsByTabs')
    // console.log('fd', fd)
    // console.log('tabs', tabs)
    // console.log('opt', opt)

    //fd
    if (!isestr(fd)) {
        fd = './models'
    }

    //type
    let type = get(opt, 'type')
    if (type !== 'js' && type !== 'json') {
        type = 'js'
    }
    //console.log('type', type)

    //fsCreateFolder
    fsCreateFolder(fd)

    //each
    each(tabs, (kpType, name) => {
        //console.log('kpType', kpType, 'name', name)

        //getModel
        let c = null
        if (type === 'js') {
            c = getJsModel(name, kpType)
        }
        else if (type === 'json') {
            c = getJsonModel(name, kpType)
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
            console.log('generate file: ', fn)
        }
        catch (err) {
            console.log('save file catch', err)
        }

    })

}


export default genModelsByTabs
