import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'


//rulebook R7: 七函數之內部初始化(initSequelize)在主try內, 其建構期例外與其他整批性錯誤同樣於reject前發一次error事件(規格T10.3)
//觸發: 本套件不相依mysql2, 以mysql://建構sequelize時即拋[Please install mysql2 package manually]; 若環境另裝mysql2則前提不成立, 斷言訊息會指出


describe('initSequelize throws', function() {

    it('七函數皆reject, 且於reject前各發一次error事件, mode為函數名、data為輸入數據或null、err與reject訊息一致', async function() {
        let w = wo({ url: 'mysql://username:password@localhost:3306', db: 'worm', cl: 'users', fdModels: './models' })
        let settled = false
        let evs = []
        w.on('error', (mode, data, err) => {
            evs.push({ mode, data, err, settled })
        })

        let cases = [
            ['select', null, () => w.select({ id: 'k1' })],
            ['selectByPk', null, () => w.selectByPk('k1')],
            ['insert', { id: 'k1', name: 'A' }, (d) => w.insert(d)],
            ['insertBulk', [{ id: 'k2', name: 'B' }], (d) => w.insertBulk(d)],
            ['save', [{ id: 'k1', name: 'Z' }], (d) => w.save(d)],
            ['del', [{ id: 'k1' }], (d) => w.del(d)],
            ['delAll', null, () => w.delAll({ id: 'k1' })],
        ]
        for (let [mode, data, fn] of cases) {
            settled = false
            evs = []
            let r = await fn(data)
                .then((v) => ({ RESOLVE: v }), (err) => ({ REJECT: String(err.message || err) }))
                .finally(() => {
                    settled = true
                })

            //整批性錯誤經Promise.reject(規格T4)
            assert.ok(r.REJECT !== undefined, `${mode} 未reject, 實得 ${JSON.stringify(r.RESOLVE)}`)
            assert.ok(r.REJECT.indexOf('Please install mysql2') >= 0, `${mode} 之reject非建構期例外(前提: 本機未裝mysql2): ${r.REJECT}`)

            //規格T10.3: 整批性錯誤於reject之前發出一次, mode取函數名, err與reject之訊息一致, data為本次輸入數據(無輸入數據者為null)
            assert.strictEqual(evs.length, 1, `${mode} 之error事件數 ${evs.length}`)
            assert.strictEqual(evs[0].mode, mode)
            assert.strictEqual(evs[0].err, r.REJECT)
            assert.deepStrictEqual(evs[0].data, data)
            assert.strictEqual(evs[0].settled, false, `${mode} 之error事件須於reject之前發出`)
        }
    })

})
