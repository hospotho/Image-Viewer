// Storage methods
var storage = {
	prefix: function(prefix, name){
		return prefix == undefined ? name : prefix+'-'+name;
	},
	create: function(table, prefix){
		table = storage.prefix(prefix, table);
		if(localStorage.getItem(table) == undefined)
			this.reset(table, {});
	},
	reset: function(table, data, prefix){
		table = storage.prefix(prefix, table);
		localStorage.setItem(table, JSON.stringify(data));
	},
	clear: function(table, prefix){
		table = storage.prefix(prefix, table);
		delete localStorage[table];
	},
	clearPrefixed: function(prefix, skipList){
		skipList = skipList == undefined ? [] : skipList;
		for(var name in localStorage){
			var id = name;
			if(id.indexOf(prefix) == 0)
				id = id.replace(prefix+'-', '')+'';
			if(name.indexOf(prefix) >= 0 && !skipList.has(id)){
				storage.clear(name);
			}
		}
	},
	insert: function(table, id, itemData, prefix){
		table = storage.prefix(prefix, table);
		var data = this.select(table);
		data[id] = itemData;
		this.reset(table, data);
	},
	update: function(table, id, itemData, prefix){
		table = storage.prefix(prefix, table);
		var data = this.select(table);
		data[id] = itemData;
		this.reset(table, data);
	},
	remove: function(table, id, prefix){
		table = storage.prefix(prefix, table);
		var data = this.select(table);
		if(data[id] !== undefined){
			delete data[id];
			this.reset(table, data);
			return true;
		}
		return false;
	},
	hasId: function(table, id, prefix){
		table = storage.prefix(prefix, table);
		var data = this.select(table);
		if(data[id] !== undefined) return true;
		return false;
	},
	select: function(table, prefix){
		table = storage.prefix(prefix, table);
		if(localStorage.getItem(table) == undefined) return false;
		return JSON.parse(localStorage.getItem(table));
	},
	selectId: function(table, id, prefix){
		var data = this.select(table);
		return data[id];
	}
};