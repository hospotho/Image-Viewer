Array.prototype.has = function(find){
	for(var id in this){
		if(this[id] == find) return true;
	}
	return false;
}
Array.prototype.indexOf = function(find){
	for(var count = 0; count <= this.length; count++){
		if(this[count] == find) return count;
	}
	return -1;
}

String.prototype.capitalize = function(){
	return this.replace( /(^|\s)([a-z])/g , function(m,p1,p2){ return p1+p2.toUpperCase(); } );
};

var log = function(log){ console.log(log) };