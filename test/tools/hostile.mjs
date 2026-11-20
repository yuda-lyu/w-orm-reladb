/* eslint-disable no-new-wrappers */ //包裝物件(new String、new Number、new Boolean)為被測之輸入, 非筆誤
//第557項(R22、R23)測試用之輸入工廠: 讀取即拋錯之值、[給了而非字串或有限數字]之主鍵值
//每次呼叫產生全新之值(已撤銷之Proxy等不可重用); 拋錯之訊息帶固定標記, 供測試斷言[固定詞彙不含原例外文字]與[存取器拋錯維持原文字]


//標記字串(不得出現在固定詞彙之錯誤訊息內)
export const SECRET = {
    tag: 'TAG-SECRET-557',
    keys: 'KEYS-SECRET-557',
    get: 'GET-SECRET-557',
}


//已撤銷之Proxy: 讀其任何成員、標籤皆拋錯
export const mkRevoked = () => {
    let r = Proxy.revocable({}, {})
    r.revoke()
    return r.proxy
}

//Symbol.toStringTag之存取器拋錯(Object.prototype.toString.call即拋錯)
export const mkTagThrow = () => ({
    get [Symbol.toStringTag]() {
        throw new Error(SECRET.tag)
    },
})

//ownKeys陷阱拋錯之Proxy(標籤可讀、成員存取可讀, 只有列舉自有鍵拋錯)
export const mkKeysThrow = () => new Proxy({ a: 1 }, {
    ownKeys() {
        throw new Error(SECRET.keys)
    },
})

//get陷阱對所有鍵(含Symbol.toStringTag)拋錯之Proxy: 讀成員與讀標籤皆拋錯
export const mkGetTrapAll = () => new Proxy({}, {
    get() {
        throw new Error(SECRET.get)
    },
})

//get陷阱只對字串鍵拋錯之Proxy: 讀成員拋錯, 但標籤(Symbol鍵)可讀——即[容器可讀而成員存取拋錯](同存取器拋錯, chkReadable無從偵測, 依共同規則四.2轉固定詞彙invalid <容器>.<成員>)
export const mkGetTrapStr = () => new Proxy({}, {
    get(t, k) {
        if (typeof k === 'string') {
            throw new Error(SECRET.get + ':' + k)
        }
        return undefined
    },
})

//不可讀之值之三種(依任務書: 已撤銷之Proxy、Symbol.toStringTag拋錯之物件、ownKeys拋錯之Proxy)
export const HOSTILE = {
    revoked: mkRevoked,
    tagThrow: mkTagThrow,
    keysThrow: mkKeysThrow,
}


//[給了而非字串或有限數字]之主鍵值(R22): 名稱 → 工廠; 不含不可讀者(另見HOSTILE)
export const GIVEN_BAD = {
    bool: () => true,
    boolFalse: () => false,
    obj: () => ({}),
    objFull: () => ({ a: 1 }),
    arr: () => [],
    arrFull: () => ['x'],
    nan: () => NaN,
    inf: () => Infinity,
    negInf: () => -Infinity,
    big: () => 1n,
    sym: () => Symbol('s'),
    date: () => new Date(0),
    fn: () => () => 'x',
    boolObj: () => new Boolean(true),
    nanObj: () => new Number(NaN),
    map: () => new Map(),
    //包裝物件(第557項全族對齊輪, 共同規則一第6點): 不拆包裝, 物件一律為[給了而非字串或有限數字]而拒絕(wsemi判斷函數只收原始值, 與w-orm-mdb之normPk一致)
    strObj: () => new String('a'),
    strObjEmpty: () => new String(''),
    numObj: () => new Number(5),
    numObjZero: () => new Number(0),
}


//[未帶]之三種(R22): undefined、null、空字串(另加鍵不存在, 由呼叫端以ABSENT表示)
export const ABSENT = Symbol('absent')
export const NOT_GIVEN = {
    absent: () => ABSENT,
    undef: () => undefined,
    null: () => null,
    empty: () => '',
}


//withId, 組出{ id, name }資料; ABSENT表示不帶id鍵
export const withId = (id, name = 'new') => {
    return id === ABSENT ? { name } : { id, name }
}


//msgOf, 取錯誤訊息(拋錯者不再拋)
export const msgOf = (err) => {
    try {
        return String(err !== null && err !== undefined && err.message !== undefined ? err.message : err)
    }
    catch (e) {
        return '<unprintable>'
    }
}


//isGen, 是否為本套件自動產生之主鍵(genIDSeq: UUIDv7形式)
export const isGen = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(s))
