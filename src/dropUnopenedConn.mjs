//sqlite開啟失敗(SQLITE_CANTOPEN: storage為資料夾、檔名超長、無權限、路徑非法等)之Database須先自sequelize之連線表移除, 才可呼叫sequelize.close()(第210項, R19):
//sequelize 6 之 sqlite connection-manager 於getConnection時先把new Database(...)存入connections再等其開啟回呼, 開啟失敗(reject)後該Database仍留在connections;
//close()經_onProcessExit對connections內每個Database呼叫close(callback), sqlite3對未開啟(open為false)之Database把close排入佇列等開啟完成, 而開啟已失敗, callback永不觸發, close()即永不settle,
//本套件各函數之finally(closeSequelize)隨之卡住, reject送不出; 純sequelize不經本套件亦可重現
//判準: Database之open存取器(sqlite3與@journeyapps/sqlcipher皆有)嚴格為false者才移除; 缺該屬性(undefined)者不動, 免得誤丟仍開啟之連線


/**
 * 移除sequelize(sqlite)連線表中未開啟(開啟失敗)之Database
 *
 * @ignore
 * @param {Object} sequelize 輸入sequelize實例
 * @returns {Number} 回傳移除之個數
 */
function dropUnopenedConn(sequelize) {
    let n = 0

    //cs, sequelize之connectionManager.connections: 以連線代號為鍵之物件, 無則不處理
    let cs = sequelize && sequelize.connectionManager ? sequelize.connectionManager.connections : null
    if (cs === null || typeof cs !== 'object') {
        return n
    }

    for (let k of Object.keys(cs)) {
        let c = cs[k]
        let open
        try {
            open = c ? c.open : undefined
        }
        catch (err) {
            open = undefined
        }
        if (open === false) {
            delete cs[k]
            n++
        }
    }

    return n
}


export default dropUnopenedConn
