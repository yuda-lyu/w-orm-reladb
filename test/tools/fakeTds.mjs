import net from 'net'


//假TDS伺服器(測試工具, 不帶.test.中綴): 只回應PRELOGIN, 供驗證「伺服器不協商加密」時驅動之行為(rulebook R21)
//  - 以PRELOGIN回應之ENCRYPTION選項宣告伺服器之加密能力: NOT_SUP(不支援)、OFF(不加密)、或省略該選項
//  - 記錄收到之TDS封包類型; 收到LOGIN7(0x10, 內含帳密)即記下並斷線: 驅動於伺服器不協商加密時若仍送出LOGIN7, 即以明文(未經TLS)送出帳密
//  - 不實作TLS與登入之後之任何流程: 其後任何連線都不會成功, 故不會有數據往來


export let TDS = { RESPONSE: 0x04, LOGIN7: 0x10, PRELOGIN: 0x12 }
export let ENC = { OFF: 0x00, ON: 0x01, NOT_SUP: 0x02, REQ: 0x03 }


//genPreloginResponse, 產生PRELOGIN回應之完整TDS封包(type 0x04, 狀態EOM); enc為ENC之值, null者省略ENCRYPTION選項
export let genPreloginResponse = (enc) => {
    let opts = [{ token: 0x00, data: Buffer.from([15, 0, 0x0f, 0xa0, 0, 0]) }] //VERSION: 15.0.4000.0
    if (enc !== null) {
        opts.push({ token: 0x01, data: Buffer.from([enc]) }) //ENCRYPTION
    }
    let head = 5 * opts.length + 1
    let total = head + opts.reduce((n, o) => n + o.data.length, 0)
    let body = Buffer.alloc(total, 0)
    let off = head
    opts.forEach((o, i) => {
        body.writeUInt8(o.token, i * 5)
        body.writeUInt16BE(off, i * 5 + 1)
        body.writeUInt16BE(o.data.length, i * 5 + 3)
        o.data.copy(body, off)
        off += o.data.length
    })
    body.writeUInt8(0xff, 5 * opts.length) //TERMINATOR
    let hd = Buffer.alloc(8, 0)
    hd.writeUInt8(TDS.RESPONSE, 0)
    hd.writeUInt8(0x01, 1) //status: EOM
    hd.writeUInt16BE(8 + body.length, 2)
    hd.writeUInt8(1, 6) //packet id
    return Buffer.concat([hd, body])
}


//obfuscatePassword, LOGIN7內密碼之編碼(MS-TDS 2.2.6.4: UTF-16LE, 每位元組高低四位元互換再XOR 0xA5); 明文送出之LOGIN7可由此找到密碼
export let obfuscatePassword = (pw) => {
    let b = Buffer.from(String(pw), 'utf16le')
    return Buffer.from(Array.from(b, (x) => (((x & 0x0f) << 4) | (x >> 4)) ^ 0xa5))
}


//closeServer, 斷開所有連線並關閉伺服器
let closeServer = (srv, socks) => new Promise((resolve) => {
    for (let s of socks) {
        s.destroy()
    }
    srv.close(() => resolve())
})


/**
 * 啟動假TDS伺服器(監聽127.0.0.1, 埠由系統配發)
 *
 * @param {Object} opt 輸入設定物件
 * @param {Number|null} opt.enc 輸入PRELOGIN回應之ENCRYPTION值(ENC之值), null者省略該選項
 * @returns {Promise} 回傳Promise, resolve { port, seen, close }; seen為 { types: 依序收到之TDS封包類型, bytes: 收到之全部位元組, login7: 是否收到LOGIN7, conns: 連線數 }
 */
export let startFakeTds = ({ enc }) => {
    return new Promise((resolve, reject) => {
        let seen = { types: [], bytes: Buffer.alloc(0), login7: false, conns: 0 }
        let socks = new Set()
        let srv = net.createServer((sock) => {
            seen.conns++
            socks.add(sock)
            sock.on('close', () => socks.delete(sock))
            sock.on('error', () => {})
            let buf = Buffer.alloc(0)
            sock.on('data', (d) => {
                seen.bytes = Buffer.concat([seen.bytes, d])
                buf = Buffer.concat([buf, d])
                while (buf.length >= 8) {
                    let len = buf.readUInt16BE(2)
                    if (len < 8 || buf.length < len) {
                        break
                    }
                    let type = buf.readUInt8(0)
                    seen.types.push(type)
                    buf = buf.subarray(len)
                    if (type === TDS.PRELOGIN) {
                        sock.write(genPreloginResponse(enc))
                    }
                    else if (type === TDS.LOGIN7) {
                        seen.login7 = true
                        sock.destroy() //登入之後之流程不實作: 斷線, 令驅動即時失敗而非等逾時
                        return
                    }
                }
            })
        })
        srv.on('error', reject)
        srv.listen(0, '127.0.0.1', () => {
            resolve({
                port: srv.address().port,
                seen,
                close: () => closeServer(srv, socks),
            })
        })
    })
}
