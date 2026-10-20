/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('twf', {
'id': {
type: DataTypes.STRING,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
'name': {
type: DataTypes.TEXT,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'twf'
});
};
