/*
function openImageViewer(targetImages){
	chrome.extension.sendRequest({method: "Get options"}, function(response) {
		var options = response.status;

		options.closeButton = true;
		$(targetImages).imageViewer(options);
	});
}*/

chrome.extension.sendRequest({ method: "Get options" }, function (response) {
	var options = response.status;
	options.closeButton = true;

	if (!$('html').hasClass('has-image-viewer')) {
		var imagesInPage = [],
			uniqueImages = [],
			uniqueImagesInPage = [],
			imgs = document.querySelectorAll('img[src]')
		bgs = [];

		// Find image in imgs
		for (var index = 0; index < imgs.length; index++) {
			// get option first to deal with resized img, add by me 
			if (imgs[index].clientWidth > options.minWidth && imgs[index].clientHeight > options.minHeight) {
				imagesInPage.push(imgs[index]);
			}
		}

		// Find background-image in all elements
		$.each($('*'), function () {
			var bg = $(this).css('background-image');

			if (bg.indexOf('url') === 0 && bg.indexOf('.svg")') === -1 ){
				var self = this,
					bgUrl = bg.substring(4, bg.length - 1).replace(/'/g, '').replace(/"/g, ''),
					img = new Image;

				if (!bgs.has(bgUrl)) {
					bgs.push(bgUrl);
					img.src = bgUrl;
					imagesInPage.push(img);
				}
			}
		});

		for (var index = 0; index < imagesInPage.length; index++) {
			var image = imagesInPage[index].src;
			if (!uniqueImages.has(image)) {
				uniqueImages.push(image);
				uniqueImagesInPage.push(imagesInPage[index]);
			}
		}
		/*
		const end_base64 = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTcwIiBoZWlnaHQ9IjgwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KIDxnIGlkPSJMYXllcl8xIj4KICA8dGl0bGU+TGF5ZXIgMTwvdGl0bGU+CiAgPHJlY3Qgc3Ryb2tlLXdpZHRoPSIwIiBpZD0ic3ZnXzIiIGhlaWdodD0iODAwIiB3aWR0aD0iNTcwIiB5PSIwIiB4PSIwIiBzdHJva2U9IiNCMUZGRkYiIGZpbGw9IiNmZmZmZmYiLz4KICA8dGV4dCBmaWxsPSIjMDAwMDAwIiBzdHJva2U9IiNCMUZGRkYiIHN0cm9rZS13aWR0aD0iMCIgeD0iMjE3LjQ0MTM3IiB5PSI0MjEuODc0OTgiIGlkPSJzdmdfMSIgZm9udC1zaXplPSI2NCIgZm9udC1mYW1pbHk9Ik5vdG8gU2FucyBKUCIgdGV4dC1hbmNob3I9InN0YXJ0IiB4bWw6c3BhY2U9InByZXNlcnZlIiBmb250LXdlaWdodD0iYm9sZCI+RU5EPC90ZXh0PgogPC9nPgoKPC9zdmc+";
		end_image = new Image()
		end_image.src = end_base64
		uniqueImagesInPage.push(end_image)*/

		/*
		// Find background-image in CSS
		var styleSheets = document.styleSheets;
		if(styleSheets){
			for(var cssIndex = 0; cssIndex < styleSheets.length; cssIndex++){
				var styleSheet = styleSheets[cssIndex],
					cssRules = styleSheet.cssRules;
	
				if(cssRules){
					for(var index = 0; index < cssRules.length; index++){
						var cssRule = cssRules[index];
	
						if(cssRule.style){
							var bg = cssRule.style['background-image'],
								bgUrl = bg.substring(4, bg.length-1).replace(/'/g,'').replace(/"/g,'');
	
							if(bg.indexOf('url') === 0 && !bgs.has(bgUrl)){
								var img = new Image;
	
								bgs.push(bgUrl);
								img.src = bgUrl;
								imagesInPage.push(img);
							}
						}
					}
				}
			}
		}
		*/
		
		//openImageViewer(uniqueImagesInPage);
		$(uniqueImagesInPage).imageViewer(options);

	} else {
		$('.__crx__image-viewer').fadeOut(100, function () {
			$('.__crx__image-viewer').remove();
			$('html').removeClass('has-image-viewer');
		});
	}

});