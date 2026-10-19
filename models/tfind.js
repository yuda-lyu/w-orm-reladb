/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tfind', {
'id': {
type: DataTypes.STRING,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
'name': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'age': {
type: DataTypes.INTEGER,
allowNull: true,
autoIncrement: false,
comment: null
},
'g': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
't': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'flag': {
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
tableName: 'tfind'
});
};
