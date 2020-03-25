module.exports = function(sequelize, DataTypes) {
    return sequelize.define('tb2', {
    "sid": {
        "type": DataTypes.STRING,
        "primaryKey": true,
        "allowNull": false,
        "autoIncrement": false,
        "comment": null
    },
    "name": {
        "type": DataTypes.STRING,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "size": {
        "type": DataTypes.DOUBLE,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    },
    "age": {
        "type": DataTypes.INTEGER,
        "primaryKey": false,
        "allowNull": true,
        "autoIncrement": false,
        "comment": null
    }
}, {
        tableName: 'tb2'
    });
};
    