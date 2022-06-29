/*
[cssTransform ver 0.1] [2012-07-04] - http://eky.hk/cssTransform
	http://eky.hk
Copyright (c) 2011 Eky Kwan, MIT License
*/
(function($) {
$.fn.cssTransform = function(options) {
	if(console.log) var log = function(log){ console.log(log) };
	
	// Default options
	var defaults = {
		
	};
	var options = $.extend(defaults, options);
	if (!this) return false;	
		
	// Find vendor prefix
	var domPrefixes = 'Webkit Moz O ms Khtml'.split(' '),
		pfx = '',
		has = {},
		prefix = {
			transform: 'transform'
		};
	
	String.prototype.capitalize = function(){
		return this.replace( /(^|\s)([a-z])/g , function(m,p1,p2){ return p1+p2.toUpperCase(); } );
	};
	for(var cssName in prefix){
		if(document.body.style[prefix[cssName]] == undefined){
			for(var key in domPrefixes){
				if( document.body.style[ domPrefixes[key] + prefix[cssName].capitalize()] !== undefined ) {
					pfx = domPrefixes[key];
					prefix[cssName] = pfx + prefix[cssName].capitalize();
					has[prefix[cssName]] = true;
					break;
				}
			}
		}else{
			has[prefix[cssName]] = true;
		}
	}
	
	function getStyle(elem, name){
		return document.defaultView.getComputedStyle(elem, null).getPropertyValue(name);
	}
		
	function transformData(value){
		var digits = /([-\d|\.]*)+(.*)/,
			valueSplit = value.split(digits),
			number = valueSplit[1]*1,
			unit = valueSplit[2];
		
		return {
			number: number,
			unit: unit
		};
	}
	
	// Main
	return this.each(function() {
		var self = this,
			pattern = /^(.*)+[\(]+(.*)+[\)]$/,
			//operaters = /^[+|\-|*|\/]/,
			operaters = /^[+|_|*|\/]/,
			digits = /([\d|\.]*)+(.*)/,
			transformStyle = this.style[prefix.transform],
			transformStyles = transformStyle.split(' '),
			transformStyleMap = {};
		
		if(transformStyle != ''){
			for(var index = 0; index < transformStyles.length; index++){
				var styles = transformStyles[index].split(pattern),
					name = styles[1],
					value = styles[2];
				
				transformStyleMap[name] = value;
			}
		}
		
		for(var name in options){
			var fullValue = options[name],
				operater = operaters.test(fullValue) ? fullValue.match(operaters)[0] : false;
			
			if(operater !== false){
				var values = transformData(fullValue.split(operaters)[1]),
					newValue = values.number;
				
				if(transformStyleMap[name]){
					var oldValue = transformStyleMap[name],
						oldValues = transformData(oldValue);
					
					switch(operater){
						case '+':
							newValue += oldValues.number;
							break;
						case '_':
							newValue = oldValues.number - newValue;
							break;
						case '*':
							newValue *= oldValues.number;
							break;
						case '/':
							newValue = oldValues.number / newValue;
							break;
					}
					newValue = '' + newValue + values.unit;
				}else{
					var defaultValue = 0;
					
					if(name == 'scale'){
						defaultValue = 1;
					}
					
					switch(operater){
						case '+':
							newValue = values.number + values.unit;
							break;
						case '_':
							newValue = -values.number + values.unit;
							break;
						case '*':
							newValue = defaultValue + values.unit;
							break;
						case '/':
							newValue = defaultValue + values.unit;
							break;
					}
				}
				options[name] = newValue;
			}
		}
		
		var newTransformStyleMap = $.extend(transformStyleMap, options),
			newTransformStyles = [],
			newTransformStyle = '';
		
		for(var index in newTransformStyleMap){
			newTransformStyles.push(index + '('+ newTransformStyleMap[index] + ')');
		}
		
		newTransformStyle = newTransformStyles.join(' ');
		self.style[prefix.transform] =  newTransformStyle;
	});
};
})(jQuery);