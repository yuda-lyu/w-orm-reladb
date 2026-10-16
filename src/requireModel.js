const { createRequire } = require('module')


//載入js格式之model檔並呼叫其定義函數
//註: 不可直接以require(fn)載入: 發布用dist經rollup之commonjs外掛打包時, 引數非字面值之require會被換成必拋[Could not dynamically require]之樁,
//故以Node內建module之createRequire依model檔之絕對路徑產生require函數載入, 其解析與模組快取皆同require
//註: fn須為絕對路徑, 呼叫端(本套件與w-orm-mdb之importModels)皆以path.resolve產生; 被w-orm-mdb等深層引用, 勿改簽章或路徑
function requireModel(fn, sequelize, DataTypes) {
    let req = createRequire(fn)
    return req(fn)(sequelize, DataTypes)
}

module.exports = requireModel
