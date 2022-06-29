function openImageViewer(targetImages){
	chrome.extension.sendRequest({method: "Get options"}, function(response) {
		var options = response.status;

		options.closeButton = true;
		options.minWidth = 0;
		options.minHeight = 0;
		$(targetImages).imageViewer(options);
	});
}

if(!$('html').hasClass('has-image-viewer')){
	chrome.extension.sendRequest({method: "Get tmp"}, function(response) {
		var tmp = response.status,
			tmpImageUrl = tmp.image,
			tmpImage = new Image;

		tmpImage.src = tmpImageUrl;
		openImageViewer(tmpImage);
	});
}else{
	$('.image-viewer').fadeOut(100, function(){
		$('.image-viewer').remove();
		$('html').removeClass('has-image-viewer');
	});
}