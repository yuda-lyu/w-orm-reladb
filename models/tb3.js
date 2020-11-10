module.exports = function(sequelize, DataTypes) {
    return sequelize.define('tb3', {
    "keyINTEGER": {
        "type": DataTypes.INTEGER,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "keyBIGINT": {
        "type": DataTypes.BIGINT,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "keyFLOAT": {
        "type": DataTypes.FLOAT,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "keyDOUBLE": {
        "type": DataTypes.DOUBLE,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "keyDECIMAL": {
        "type": DataTypes.DECIMAL,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "keyDATE": {
        "type": DataTypes.DATE,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "keyBOOLEAN": {
        "type": DataTypes.BOOLEAN,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "keySTRING": {
        "type": DataTypes.STRING,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "keyTEXT": {
        "type": DataTypes.TEXT,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    }
}, {
        tableName: 'tb3'
    });
};
    