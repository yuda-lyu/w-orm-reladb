import fs from 'fs'
import JSON5 from 'json5'
import get from 'lodash/get'
import each from 'lodash/each'
import trim from 'lodash/trim'
import join from 'lodash/join'
import iseobj from 'wsemi/src/iseobj.mjs'
import sep from 'wsemi/src/sep.mjs'


function modifyModel(fn) {

    //h
    let h = fs.readFileSync(fn, 'utf8')

    //s
    let s = JSON5.parse(h)

    //check
    if (!iseobj(get(s, 'fields'))) {
        console.log('invalid fields')
        return
    }

    //自動針對id設定為主鍵
    each(s.fields, (v, k) => {
        if (k === 'id') {
            v.primaryKey = true
        }
    })

    // // //j
    // // let r = `define[\\s\\S]+}, {`
    // // let reg = new RegExp(r, 'g')
    // // let j = h.match(reg)[0]

    // //s
    // //let s = sep(j, '\n')
    // let s = sep(h, '\n')
    // // console.log('s', s)

    // //find ind
    // let indIDs = null
    // let indIDe = null
    // let indHasPK = false
    // each(s, (v, k) => {
    //     v = trim(v)
    //     if (v === `'id': {`) {
    //         indIDs = k
    //     }
    //     if (indIDs !== null && indIDe === null && v.indexOf('primaryKey: true') >= 0) {
    //         indHasPK = true
    //     }
    //     if (indIDs !== null && v === '}') {
    //         indIDe = k
    //     }
    // })

    // //add primaryKey
    // //console.log(`indIDs=${indIDs}, indIDe=${indIDe}, indHasPK=${indHasPK}`)
    // if (indIDs !== null && !indHasPK) {
    //     //若id沒有被設定為pk, 則需要強制設為pk, 否則sequelize無法匯入
    //     s[indIDs] += 'primaryKey: true,' //用json5轉不用考慮是否最末不補逗號
    //     // if (indIDs + 2 < indIDe) {
    //     //     //不只id欄位故要添加結尾逗號
    //     //     s[indIDs] += ','
    //     // }
    //     console.log('modify:', fn)
    // }

    // //c
    // let c = join(s, '\n')

    // //replace
    // //let h2 = h.replace(reg, c)
    // let h2 = c
    // // console.log('h2', h2)

    let h2 = JSON5.stringify(s, null, 4)
    // console.log('h2', h2)

    //write
    fs.writeFileSync(fn, h2, 'utf8')

}


export default modifyModel
