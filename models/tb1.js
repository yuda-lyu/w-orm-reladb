module.exports = function(sequelize, DataTypes) {
    return sequelize.define('tb1', {
    "id": {
        "type": DataTypes.STRING,
        "primaryKey": true,
        "allowNull": false,
        "autoIncrement": false,
        "comment": null
    },
    "title": {
        "type": DataTypes.TEXT,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "price": {
        "type": DataTypes.DOUBLE,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "isActive": {
        "type": DataTypes.INTEGER,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    }
}, {
        tableName: 'tb1'
    });
};
    