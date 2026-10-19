/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tdate', {
'id': {
type: DataTypes.STRING,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
'n': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'd': {
type: DataTypes.DATE,
allowNull: true,
autoIncrement: false,
comment: null
},
'd2': {
type: DataTypes.DATE,
allowNull: true,
autoIncrement: false,
comment: null
},
'o': {
type: DataTypes.DATEONLY,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'tdate'
});
};
