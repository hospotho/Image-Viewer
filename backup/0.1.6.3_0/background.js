var table = 'options',
	tmp = 'tmp',
	requiredOptions = 'fitWhenLarger fit zoom rotate minWidth minHeight'.split(' ');

function resetOptions(){
	storage.update(table, 'fitWhenLarger', true);
	storage.update(table, 'fit', 'both');
	storage.update(table, 'zoom', 1.5);
	storage.update(table, 'rotate', 15);
	storage.update(table, 'minWidth', 100);
	storage.update(table, 'minHeight', 100);
}
function resetLocalStorage(){
	if(!storage.select(table)){
		storage.create(table);
		resetOptions();
		window.open('options.html');
	}else{
		var options = storage.select(table),
			isOptionPageOpened = false;
		
		for(var index = 0; index < requiredOptions.length; index++){
			var requiredOption = requiredOptions[index];
			if(options[requiredOption] == undefined){
				resetOptions();
				window.open('options.html');
				isOptionPageOpened = true;
				break;
			}
		}

		if(!isOptionPageOpened && (navigator.userAgent.toLowerCase().indexOf('chrome/24.0') >= 0 || navigator.userAgent.toLowerCase().indexOf('chrome/25.0') >= 0)) {
			if(!options.insert_css_bug_in_24_to_25_msg_shown)
				window.open('options.html');
			storage.update(table, 'insert_css_bug_in_24_to_25_msg_shown', true);
		}
	}
	
	if(!storage.select(tmp)){
		storage.create(tmp);
		storage.update(tmp, 'image', '');
	}
}
resetLocalStorage();

chrome.extension.onRequest.addListener(function(request, sender, sendResponse) {
	resetLocalStorage();
    if (request.method == "Get options")
		sendResponse({status: storage.select(table)});
    else if (request.method == "Get tmp")
		sendResponse({status: storage.select(tmp)});
    else
		sendResponse({}); 
});

chrome.browserAction.onClicked.addListener(function(tab){
	chrome.tabs.insertCSS(tab.id, {file: 'css/viewer.css'});
	chrome.tabs.executeScript(tab.id, {file: 'scripts/prototypes.js'});
	chrome.tabs.executeScript(tab.id, {file: 'scripts/jquery.js'});
	chrome.tabs.executeScript(tab.id, {file: 'scripts/jquery.mousewheel.js'});
	chrome.tabs.executeScript(tab.id, {file: 'scripts/storage.js'});
	chrome.tabs.executeScript(tab.id, {file: 'scripts/css-transform.js'});
	chrome.tabs.executeScript(tab.id, {file: 'image-viewer.js'});
	chrome.tabs.executeScript(tab.id, {file: 'activate-page.js'});
});

function i18n(name){
	return chrome.i18n.getMessage(name);
}

chrome.contextMenus.removeAll();
chrome.contextMenus.create({
	title: i18n('open_in_image_viewer'),
	contexts: ['image'],
	onclick: function(info, tab){
		// Store the image for content script use
		storage.update(tmp, 'image', info.srcUrl);
		
		chrome.tabs.insertCSS(tab.id, {file: 'css/viewer.css'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/prototypes.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/jquery.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/jquery.mousewheel.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/storage.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/css-transform.js'});
		chrome.tabs.executeScript(tab.id, {file: 'image-viewer.js'});
		chrome.tabs.executeScript(tab.id, {file: 'activate-image.js'});
	}
});
chrome.contextMenus.create({
	title: i18n('view_images_in_image_viewer'),
	contexts: ['page'],
	onclick: function(info, tab){
		chrome.tabs.insertCSS(tab.id, {file: 'css/viewer.css'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/prototypes.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/jquery.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/jquery.mousewheel.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/storage.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/css-transform.js'});
		chrome.tabs.executeScript(tab.id, {file: 'image-viewer.js'});
		chrome.tabs.executeScript(tab.id, {file: 'activate-page.js'});
	}
});
chrome.contextMenus.create({
	title: i18n('view_all_images_in_image_viewer'),
	contexts: ['browser_action'],
	onclick: function(info, tab){
		chrome.tabs.insertCSS(tab.id, {file: 'css/viewer.css'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/prototypes.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/jquery.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/jquery.mousewheel.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/storage.js'});
		chrome.tabs.executeScript(tab.id, {file: 'scripts/css-transform.js'});
		chrome.tabs.executeScript(tab.id, {file: 'image-viewer.js'});
		chrome.tabs.executeScript(tab.id, {file: 'activate-all.js'});
	}
});