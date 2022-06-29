$(function(){
	var table = 'options';
	
	var options = storage.select(table);
	
	$('input[name=zoom]').val(options.zoom);
	$('input[name=zoom] + .display').html(options.zoom);
	
	$('input[name=rotate]').val(options.rotate);
	$('input[name=rotate] + .display').html(options.rotate);
	
	$('input[name=minWidth]').val(options.minWidth);
	$('input[name=minHeight]').val(options.minHeight);

	if(options.fitWhenLarger){
		document.querySelector('input[name=fitWhenLarger]').checked = true;
	}

	$('#fit-' + options.fit).attr('checked', true);
	
	$('input[name=fit]').on('change', function(){
		storage.update(table, 'fit', $(this).val());
	});

	$('input[type=number]').on('change', function(){
		var name = $(this).attr('name'),
			value = this.value;
		log(value);
		storage.update(table, name, value);
	});

	$('input[type=checkbox]').on('change', function(){
		var name = $(this).attr('name'),
			value = this.checked;
		
		storage.update(table, name, value);
	});
	
	$('input[type=range]').on('change', function(){
		var name = $(this).attr('name'),
			value = this.value,
			display = $('+ .display', this);
		
		display.html(value);
		
		storage.update(table, name, value);
	});
	
	// i18n
	function i18n(name){
		return chrome.i18n.getMessage(name);
	}
	$.each($('[data-i18n]'), function(){
		if(message = chrome.i18n.getMessage($(this).attr('data-i18n'))){
			this.innerHTML = message;
			if(this.value != '') this.value = message;
		}
	});

	// Bug msg
	var insert_css_bug_in_24_to_25_msg = $('#insert_css_bug_in_24_to_25_msg');
	if(!(navigator.userAgent.toLowerCase().indexOf('chrome/24.0') >= 0 || navigator.userAgent.toLowerCase().indexOf('chrome/25.0') >= 0)){
		insert_css_bug_in_24_to_25_msg.hide();
	}
});