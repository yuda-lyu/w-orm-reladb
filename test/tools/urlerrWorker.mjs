//以不合格之opt.url建構WOrmReladb且不捕獲例外, 供unit-urlerr.test.mjs取得Node對未捕獲例外輸出之stderr
//用法: node test/tools/urlerrWorker.mjs <opt.url>
import wo from '../../src/WOrmReladb.mjs'


wo({ url: process.argv[2] })
