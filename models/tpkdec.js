/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tpkdec', {
'id': {
type: DataTypes.DECIMAL(10, 2),
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
tableName: 'tpkdec'
});
};
