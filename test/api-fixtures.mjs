//共用測試數據, 對應g-mssql.mjs與g-sqlite.mjs之rs與rsm


//genRs, 初始插入數據, 第3筆id為空字串會自動產生主鍵
export let genRs = () => {
    return [
        {
            id: 'id-peter',
            name: 'peter',
            value: 123,
        },
        {
            id: 'id-rosemary',
            name: 'rosemary',
            value: 123.456,
        },
        {
            id: '',
            name: 'kettle',
            value: 456,
        },
    ]
}


//genRsm, 儲存(修改)數據, 第3筆id為空字串需視autoInsert決定是否插入
export let genRsm = () => {
    return [
        {
            id: 'id-peter',
            name: 'peter(modify)',
        },
        {
            id: 'id-rosemary',
            name: 'rosemary(modify)',
        },
        {
            id: '',
            name: 'kettle(modify)',
        },
    ]
}


//sortByName, select結果排序供穩定比對
export let sortByName = (rows) => {
    return [...rows].sort((a, b) => (a.name < b.name ? -1 : 1))
}
