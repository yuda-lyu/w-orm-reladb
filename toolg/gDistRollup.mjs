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
    },
    external: [
        'events',
        'fs',
        'path',
        'sequelize',
        'mssql',
        'sqlite',
        'async',
    ],
})

