import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


rollupFiles({
    fns: 'WOrmReladb.mjs',
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    globals: {
        'events': 'events',
        'fs': 'fs',
        'path': 'path',
        'sequelize': 'sequelize',
        'mssql': 'mssql',
        'sqlite': 'sqlite',
        'async': 'async',
        'eslint': 'eslint', //w-auto-sequelize的auto-sequelize.js有使用eslint, 故得設定eslint為不打包名單
    },
    external: [
        'events',
        'fs',
        'path',
        'sequelize',
        'mssql',
        'sqlite',
        'async',
        'eslint',
    ],
})

