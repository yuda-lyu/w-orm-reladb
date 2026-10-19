/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tdatei', {
'id': {
type: DataTypes.INTEGER,
allowNull: false,
primaryKey: true,
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
tableName: 'tdatei'
});
};
