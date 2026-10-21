/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tlower', {
'id': {
type: DataTypes.INTEGER,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
's': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'n': {
type: DataTypes.INTEGER,
allowNull: true,
autoIncrement: false,
comment: null
},
'b': {
type: DataTypes.BOOLEAN,
allowNull: true,
autoIncrement: false,
comment: null
},
'd': {
type: DataTypes.DATE,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'tlower'
});
};
