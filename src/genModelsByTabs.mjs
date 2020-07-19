import fs from 'fs'
import each from 'lodash/each'
import get from 'lodash/get'
import replace from 'wsemi/src/replace.mjs'
import strright from 'wsemi/src/strright.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'


function getField(key, type, pk = false) {
    if (type !== 'STRING' && type !== 'INTEGER' && type !== 'DOUBLE') {
        console.log(`invalid type for ${type}. The type is support STRING, INTEGER, DOUBLE only.`)
        type = 'STRING'
    }
    let o = {
        type: `DataTypes.${type}`,
        primaryKey: false,
        allowNull: true,
        autoIncrement: false,
        comment: null
    }
    if (pk) {
        o.primaryKey = true
        o.allowNull = false
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
        fields[k] = getField(k, t, pk)
    })
    return fields
}

function getModel(name, kpType) {

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
    tmp = replace(tmp, '"DataTypes.STRING"', 'DataTypes.STRING')
    tmp = replace(tmp, '"DataTypes.INTEGER"', 'DataTypes.INTEGER')
    tmp = replace(tmp, '"DataTypes.DOUBLE"', 'DataTypes.DOUBLE')

    return tmp
}


function genModelsByTabs(fd, tabs) {

    //each
    each(tabs, (kpType, name) => {

        //getModel
        let c = getModel(name, kpType)
        // console.log(c)

        //fn
        if (strright(fd, 1) !== '/') {
            fd = `${fd}/`
        }
        let fn = `${fd}/${name}.js`

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