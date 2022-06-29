/*
[imageViewer ver 0.1.6] [2012-07-04] - http://eky.hk/imageViewer
	http://eky.hk
Copyright (c) 2011 Eky Kwan, MIT License
*/
;(function ($) {
  $.fn.imageViewer = function (options) {
    var imageList = this,
      imageSources = [],
      dragging = false,
      hasAlt = false

    $.each(imageList, function () {
      imageSources.push(this.src)
    })

    // Default options
    var defaults = {
      reinit: false,
      fit: 'both', // both | width | height | original
      zoom: 1.5,
      rotate: 15,
      closeButton: false,
      minWidth: 100,
      minHeight: 100
    }
    var options = $.extend(defaults, options)
    if (!this) return false

    // Find vendor prefix
    var domPrefixes = 'Webkit Moz O ms Khtml'.split(' '),
      pfx = '',
      has = {},
      prefix = {
        transform: 'transform',
        perspective: 'perspective',
        userSelect: 'userSelect'
      }

    String.prototype.capitalize = function () {
      return this.replace(/(^|\s)([a-z])/g, function (m, p1, p2) {
        return p1 + p2.toUpperCase()
      })
    }

    for (var cssName in prefix) {
      if (document.body.style[prefix[cssName]] == undefined) {
        for (var key in domPrefixes) {
          if (document.body.style[domPrefixes[key] + prefix[cssName].capitalize()] !== undefined) {
            pfx = domPrefixes[key]
            prefix[cssName] = pfx + prefix[cssName].capitalize()
            has[prefix[cssName]] = true
            break
          }
        }
      } else {
        has[prefix[cssName]] = true
      }
    }

    var appName = '__crx__image-viewer',
      imageListName = '__crx__image-list'

    // Close Image Viewer
    function closeImageViewer() {
      $('.' + appName).fadeOut(100, function () {
        $('.' + appName).remove()
        $('html').removeClass('has-image-viewer')
      })
    }

    // Build main frame
    if (!options.reinit && !$('html').hasClass('has-image-viewer')) {
      $('html').addClass('has-image-viewer')
      $('body').append(
        `<div class="${appName}">           
		<ul class="${imageListName}"></ul>
		<nav class="${appName}-control">
		<div class="${appName}-relate">
		<ul>
		<li><button class="${appName}-control-prev">Previous</button>
		<li><button class="${appName}-control-next">Next</button>
		</ul>
		<p class="${appName}-relate-counter">
		<span class="${appName}-relate-counter-current">1</span>/<span class="${appName}-relate-counter-total">0</span>
		</p>
		</div>
		<ul class="${appName}-control-buttons">
		<li><button data-fit="both" data-tooltip="Fit window" class="${appName}-control-button-both">Fit window</button>
		<li><button data-fit="width" data-tooltip="Fit width" class="${appName}-control-button-width">Fit width</button>
		<li><button data-fit="height" data-tooltip="Fit height" class="${appName}-control-button-height">Fit height</button>
		<li><button data-fit="original" data-tooltip="Original size" class="${appName}-control-button-original">1:1</button>
		<li><button class="${appName}-button-moveto">move to image</button>
		</ul>
		<ul class="${appName}-info">
		<li><span class="label"><span data-i18n="width">Width</span>: </span>
		<input class="${appName}-info-width"/>
		<li><span class="label"><span data-i18n="height">Height</span>: </span>
		<input class="${appName}-info-height"/>
		</ul>
		</nav>
		<button class="${appName}-button-close">Close</button>
		</div>`
      )
      // document.querySelector('body > div.__crx__image-viewer').attachShadow({mode: 'open'})

      // i18n
      if (chrome.i18n.getMessage) {
        $.each($('.' + appName + ' [data-i18n]'), function () {
          if ((message = chrome.i18n.getMessage($(this).attr('data-i18n')))) {
            this.innerHTML = message
            if (this.value != '') this.value = message
          }
        })
      }

      // Relate items
      if (imageSources.length > 1) {
        var relateControl = {
            prev: $('.' + appName + '-relate .' + appName + '-control-prev'),
            next: $('.' + appName + '-relate .' + appName + '-control-next')
          },
          relateCounter = $('.' + appName + '-relate .' + appName + '-relate-counter-current'),
          _imageViewer = $('.' + appName),
          _imageList = $('.' + appName + ' .' + imageListName + ''),
          totalItems = $('li', _imageList).length

        var debounceTimeout
        function prevItem() {
          clearTimeout(debounceTimeout)
          var loadedItemCount = $('li.loaded', _imageList).length
          if (loadedItemCount > 1) {
            var currentListItem = $('li.loaded.current', _imageList),
              currentImage = $('li.loaded.current img.current', _imageList),
              currentIndex = currentListItem.index('.' + appName + ' .' + imageListName + ' li'),
              relateListItem,
              relateImage,
              relateIndex

            var prevCount = currentIndex,
              prevFound = false
            while (prevCount >= 0) {
              if ($('li.loaded:nth-child(' + prevCount + ')', _imageList).length >= 1) {
                relateListItem = $('li.loaded:nth-child(' + prevCount + ')', _imageList)
                relateImage = $('li.loaded:nth-child(' + prevCount + ') img', _imageList)
                prevFound = true
                break
              }
              prevCount--
            }

            if (!prevFound) {
              /*
							var loadedLength = $('li.loaded', _imageList).length;
							relateListItem = $('li.loaded:nth-child('+loadedLength+')', _imageList);
							relateImage = $('li.loaded:nth-child('+loadedLength+') img', _imageList);
							*/
              var prevCount = $('li', _imageList).length,
                prevFound = false
              while (prevCount >= 0) {
                if ($('li.loaded:nth-child(' + prevCount + ')', _imageList).length >= 1) {
                  relateListItem = $('li.loaded:nth-child(' + prevCount + ')', _imageList)
                  relateImage = $('li.loaded:nth-child(' + prevCount + ') img', _imageList)
                  prevFound = true
                  break
                }
                prevCount--
              }
            }
            relateIndex = relateListItem.index('.' + appName + ' .' + imageListName + ' li')
            loadedRelateIndex = relateListItem.index('.' + appName + ' .' + imageListName + ' li.loaded')

            if (relateImage) {
              $('li.current', _imageList).removeClass('current')
              $('li.current img', _imageList).removeClass('current')
              relateListItem.addClass('current')
              relateImage.addClass('current')

              _imageList.css({
                top: -relateIndex * 100 + '%'
              })
              relateCounter.html(loadedRelateIndex + 1)

              var thisImageWidth = relateImage.attr('data-original-width'),
                thisImageHeight = relateImage.attr('data-original-height')

              $('.' + appName + '-info-width').val(thisImageWidth)
              $('.' + appName + '-info-height').val(thisImageHeight)
            }
          }
        }

        function nextItem() {
          var loadedItemCount = $('li.loaded', _imageList).length
          if ($('li.loaded.current', _imageList).length == 0) {
            $('li.loaded:nth-child(1)', _imageList).addClass('current')
          }
          if (loadedItemCount > 1) {
            var currentListItem = $('li.loaded.current', _imageList),
              currentImage = $('li.loaded.current img.current', _imageList),
              currentIndex = currentListItem.index('.' + appName + ' .' + imageListName + ' li'),
              relateListItem,
              relateImage,
              relateIndex

            var nextCount = currentIndex + 2,
              nextFound = false
            while (nextCount <= $('li', _imageList).length) {
              if ($('li.loaded:nth-child(' + nextCount + ')', _imageList).length >= 1) {
                relateListItem = $('li.loaded:nth-child(' + nextCount + ')', _imageList)
                relateImage = $('li.loaded:nth-child(' + nextCount + ') img', _imageList)
                nextFound = true
                break
              }
              nextCount++
            }

            if (!nextFound) {
              clearTimeout(debounceTimeout)
              debounceTimeout = setTimeout(() => {
                var nextCount = 1,
                  nextFound = false
                while (nextCount <= $('li', _imageList).length) {
                  if ($('li.loaded:nth-child(' + nextCount + ')', _imageList).length >= 1) {
                    relateListItem = $('li.loaded:nth-child(' + nextCount + ')', _imageList)
                    relateImage = $('li.loaded:nth-child(' + nextCount + ') img', _imageList)
                    nextFound = true
                    break
                  }
                  nextCount++
                }
                relateIndex = relateListItem.index('.' + appName + ' .' + imageListName + ' li')
                loadedRelateIndex = relateListItem.index('.' + appName + ' .' + imageListName + ' li.loaded')

                if (relateImage) {
                  $('li.current img', _imageList).removeClass('current')
                  $('li.current', _imageList).removeClass('current')
                  relateListItem.addClass('current')
                  relateImage.addClass('current')

                  _imageList.css({
                    top: -relateIndex * 100 + '%'
                  })
                  relateCounter.html(loadedRelateIndex + 1)

                  var thisImageWidth = relateImage.attr('data-original-width'),
                    thisImageHeight = relateImage.attr('data-original-height')

                  $('.' + appName + '-info-width').val(thisImageWidth)
                  $('.' + appName + '-info-height').val(thisImageHeight)
                }
              }, 1000)
              return
            }

            /*
						if($('li.loaded.current ~ li.loaded', _imageList).length >= 1){
							relateListItem = $($('li.loaded.current ~ li.loaded', _imageList)[0]);
							relateImage = $($('li.loaded.current ~ li.loaded img', _imageList)[0]);
						}else{
							var loadedLength = $('li.loaded', _imageList).length;
							relateListItem = $('li.loaded:nth-child(1)', _imageList);
							relateImage = $('li.loaded:nth-child(1) img', _imageList);
						}
						*/
            relateIndex = relateListItem.index('.' + appName + ' .' + imageListName + ' li')
            loadedRelateIndex = relateListItem.index('.' + appName + ' .' + imageListName + ' li.loaded')

            if (relateImage) {
              $('li.current img', _imageList).removeClass('current')
              $('li.current', _imageList).removeClass('current')
              relateListItem.addClass('current')
              relateImage.addClass('current')

              _imageList.css({
                top: -relateIndex * 100 + '%'
              })
              relateCounter.html(loadedRelateIndex + 1)

              var thisImageWidth = relateImage.attr('data-original-width'),
                thisImageHeight = relateImage.attr('data-original-height')

              $('.' + appName + '-info-width').val(thisImageWidth)
              $('.' + appName + '-info-height').val(thisImageHeight)
            }
          }
        }

        relateControl.prev.on('click', function () {
          prevItem()
        })
        relateControl.next.on('click', function () {
          nextItem()
        })
        $('.' + appName + '-control').unmousewheel()
        $('.' + appName + '-control').mousewheel(function (event, delta, deltaX, deltaY) {
          if (delta > 0) prevItem()
          else nextItem()
          if ($('html').hasClass('has-image-viewer')) return false
        })

        $(document).on('keydown', function (e) {
          if (e.keyCode == 37 || e.keyCode == 38) {
            // <- ^
            prevItem()
            return false
          }
          if (e.keyCode == 39 || e.keyCode == 40) {
            // -> v
            nextItem()
            return false
          }
          if (e.keyCode == 27) {
            // Esc
            closeImageViewer()
            return false
          }
        })
      } else {
        $('.' + appName + '-relate').addClass('no-relate')
      }

      // Fitting control
      $('.' + appName + '-control-button-' + options.fit).addClass('on')

      $('.' + appName + '-control-buttons button').on('click', function () {
        $('.' + appName + '-control-buttons button').removeClass('on')
        $(this).addClass('on')
        var newOptions = options
        newOptions['reinit'] = true
        newOptions['fit'] = $(this).attr('data-fit')
        $(imageList).imageViewer(options)
      })

      $('.' + appName + '-button-moveto').on('click', function () {
        var imgUrl = document.querySelector('.current img').src
        var imgList = [...document.querySelectorAll('img')]
        for (let i = 0; i < imgList.length; i++) {
          if (imgUrl === imgList[i].src) {
            console.log('moveto')
            imgList[i].scrollIntoView({block: 'center'})
            break
          }
        }
        closeImageViewer()
      })

      // Check key
      $(document).on('keydown', function (e) {
        if (e.keyCode == 18) {
          // Alt
          hasAlt = true
          return false
        }
      })
      $(document).on('keyup', function (e) {
        if (e.keyCode == 18) {
          // Alt
          hasAlt = false
          return false
        }
      })
      $(window).on('blur', function () {
        hasAlt = false
      })

      // Close button
      if (options.closeButton) {
        $('.' + appName + ' .' + appName + '-button-close').addClass('show')
        if ($('html').hasClass('has-image-viewer')) {
          $('.' + appName + ' .' + appName + '-button-close').on('click', function () {
            closeImageViewer()
          })
          $(document).on('contextmenu', '.' + appName + ' .' + appName + '-button-close', function (e) {
            close()
            return false
          })
          $('.' + appName + ' .' + appName + '-button-close').unmousewheel()
          $('.' + appName + ' .' + appName + '-button-close').mousewheel(function (event, delta, deltaX, deltaY) {
            if (delta > 0) prevItem()
            else nextItem()
            if ($('html').hasClass('has-image-viewer')) return false
          })
        }
      }
    }

    var _imageViewer = $('.' + appName),
      _imageList = $('.' + appName + ' .' + imageListName + ''),
      windowWidth = $(window).width(),
      windowHeight = $(window).height()

    if (!options.reinit) {
      _imageList.html('')
      buildImageList(imageSources)
    }

    $(window).off('resize')
    $(window).on('resize', function () {
      ;(windowWidth = $(window).width()), (windowHeight = $(window).height())
      for (var index = 0; index < imageSources.length; index++) {
        imageLoaded(imageSources[index])
      }
    })

    // Generate list with empty image
    function buildImageList(imageSources) {
      console.log(imageSources.length)
      for (var index = 0; index < imageSources.length; index++) {
        var source = imageSources[index],
          imageIndex = imageSources.indexOf(source),
          listItemClass = appName + '-list-' + imageIndex,
          imageClass = appName + '-index-' + imageIndex

        imageClass = index == 0 ? imageClass + ' current' : imageClass
        listItemClass = index == 0 ? listItemClass + ' current' : listItemClass

        _imageList.append('' + '<li class="' + listItemClass + ' loading">' + '<img class="' + imageClass + '" src="' + source + '" alt="" />' + '</li>')
      }
    }

    // Position image when loaded
    function imageLoaded(source, addEvent) {
      var imageIndex = imageSources.indexOf(source),
        imageClass = appName + '-index-' + imageIndex

      var _image = $('.' + appName + ' .' + imageClass)

      var imageWidth = _image.attr('data-original-width') ? _image.attr('data-original-width') : _image.width(),
        imageHeight = _image.attr('data-original-height') ? _image.attr('data-original-height') : _image.height(),
        imageRatioWidth = imageHeight / imageWidth,
        imageRatioHeight = imageWidth / imageHeight,
        imagePos = (startPos = {x: 0, y: 0}),
        sizeFilterPass = false

      // console.log(source)
      // if (source == end_base64) {
      // 	console.log("end_base64")
      // }

      if (imageWidth < options.minWidth || imageHeight < options.minHeight) {
        var imageIndex = $(_image)
          .parent()
          .index('.' + appName + ' .' + imageListName + ' li')
        /* おまじないです、動かないでください */
        $(_image).removeClass('current')
        $(_image).parent().removeClass('current')

        $(_image).parent().remove()
      } else {
        $(_image).parent().removeClass('loading')
        $(_image).parent().addClass('loaded')
        var loadedCount = $('.' + appName + ' .' + imageListName + ' li.loaded').length
        $('.' + appName + '-relate-counter-total').html(loadedCount)
        sizeFilterPass = true
      }

      var currentImage = $('li.current', _imageList)
      if (currentImage.length == 0) {
        $('li.loaded', _imageList).addClass('current')
        $('li.loaded img', _imageList).addClass('current')
        var currentListItem = $('li.loaded.current', _imageList),
          currentImage = $('li.loaded.current img', _imageList),
          currentIndex = currentListItem.index('.' + appName + ' .' + imageListName + ' li')

        var thisImageWidth = currentImage.attr('data-original-width'),
          thisImageHeight = currentImage.attr('data-original-height')

        $('.' + appName + '-info-width').val(thisImageWidth)
        $('.' + appName + '-info-height').val(thisImageHeight)

        _imageList.css({
          top: -currentIndex * 100 + '%'
        })
      }

      if (sizeFilterPass) {
        if (!_image.attr('data-original-width')) _image.attr('data-original-width', imageWidth)

        if (!_image.attr('data-original-height')) _image.attr('data-original-height', imageHeight)

        if (!options.reinit) {
          if ($(_image).hasClass('current')) {
            $('.' + appName + '-info-width').val(imageWidth)
            $('.' + appName + '-info-height').val(imageHeight)
          }
          $('.' + appName + '-info input').on('mouseup', function () {
            this.select()
          })
        }

        // Events
        if (addEvent && !options.reinit) {
          $(_image).parent().unmousewheel()
          $(_image)
            .parent()
            .mousewheel(function (event, delta, deltaX, deltaY) {
              if (!$(this).hasClass('current')) return

              var self = $(this).children('img'),
                thisWidth = $(self).width(),
                thisHeight = $(self).height()

              if (hasAlt) {
                if (delta > 0) {
                  $(self).cssTransform({
                    rotate: '_' + options.rotate + 'deg'
                  })
                } else {
                  $(self).cssTransform({
                    rotate: '+' + options.rotate + 'deg'
                  })
                }
              } else {
                if (delta > 0) {
                  /*
								$(self).css({
									width: thisWidth * options.zoom,
									height: thisHeight * options.zoom,
									'margin-left': -thisWidth * options.zoom / 2,
									'margin-top': -thisHeight * options.zoom / 2
								});
								*/
                  $(self).cssTransform({
                    scale: '*' + options.zoom
                  })
                } else {
                  /*
								$(self).css({
									width: thisWidth / options.zoom,
									height: thisHeight / options.zoom,
									'margin-left': -thisWidth / options.zoom / 2,
									'margin-top': -thisHeight / options.zoom / 2
								});
								*/
                  $(self).cssTransform({
                    scale: '/' + options.zoom
                  })
                }
              }
              if ($('html').hasClass('has-image-viewer')) return false
            })

          if (!$(_image).hasClass('__crx__event-binded')) {
            // Double click to reset
            $(_image).attr('data-image-pos-x', 0)
            $(_image).attr('data-image-pos-y', 0)
            $(_image)
              .parent()
              .on('dblclick', function () {
                var self = $(this).children('img')
                if (!$(self).hasClass('current')) return

                self.removeClass('no-transition')
                $(self).cssTransform({
                  scale: '1',
                  rotate: '0deg',
                  translateX: '0px',
                  translateY: '0px'
                })
                imagePos = startPos = {
                  x: 0,
                  y: 0
                }
                /*
							$(self).attr('data-image-pos-x', 0);
							$(self).attr('data-image-pos-y', 0);
							*/
              })

            // Dragging
            $(_image)
              .parent()
              .on('mousedown', function (e) {
                var self = $(this).children('img')
                if (!self.hasClass('current')) return

                if (hasAlt) {
                  if (!self.hasClass('mirror-reflect')) {
                    self.addClass('mirror-reflect')
                    $(self).cssTransform({
                      scaleX: '-1'
                    })
                  } else {
                    self.removeClass('mirror-reflect')
                    $(self).cssTransform({
                      scaleX: '1'
                    })
                  }
                }

                if (!dragging) {
                  dragging = true
                  self.addClass('no-transition')
                  $('html').addClass('no-select')

                  /*
								imagePos = {
									x: $(self).attr('data-image-pos-x')*1,
									y: $(self).attr('data-image-pos-y')*1
								};
								*/
                  startPos = {
                    x: e.clientX - imagePos.x,
                    y: e.clientY - imagePos.y
                  }
                }
              })
            $(document).on('mousemove', function (e) {
              var self = $(_image)
              //var self = $('.'+imageListName+' li.current img');
              if (!$(self).hasClass('current')) return

              if (dragging) {
                //var self = $(this).children('img');
                dragging = true
                self.cssTransform({
                  translateX: e.clientX - startPos.x + 'px',
                  translateY: e.clientY - startPos.y + 'px'
                })
              }
            })
            $(document).on('mouseup', function (e) {
              var self = $(_image)
              if (!self.hasClass('current')) return

              self.removeClass('no-transition')
              if (dragging) {
                //var self = $(this).children('img');
                dragging = false
                self.removeClass('no-transition')
                $('html').removeClass('no-select')
                imagePos = {
                  x: e.clientX - startPos.x,
                  y: e.clientY - startPos.y
                }
                /*
								self.attr('data-image-pos-x', e.clientX - startPos.x);
								self.attr('data-image-pos-y', e.clientY - startPos.y);
								*/
              }
            })
            $(_image).addClass('__crx__event-binded')
          }
        }

        var newWidth = imageWidth,
          newHeight = imageHeight

        switch (options.fit) {
          case 'both':
            if (imageWidth > windowWidth || imageHeight > windowHeight || !options.fitWhenLarger) {
              newWidth = windowWidth
              newHeight = newWidth * imageRatioWidth

              if (newHeight > windowHeight) {
                ;(newHeight = windowHeight), (newWidth = windowHeight * imageRatioHeight)
              }
            }
            break
          case 'width':
            if (imageWidth > windowWidth || !options.fitWhenLarger) {
              newWidth = windowWidth
              newHeight = newWidth * imageRatioWidth
            }
            break
          case 'height':
            if (imageHeight > windowHeight || !options.fitWhenLarger) {
              ;(newHeight = windowHeight), (newWidth = windowHeight * imageRatioHeight)
            }
            break
          case 'original':
            break
        }

        _image.css({
          width: newWidth,
          height: newHeight,
          'margin-left': -newWidth / 2,
          'margin-top': -newHeight / 2
        })
        if (!options.reinit) {
          $(_image).cssTransform({
            translateX: '0px',
            translateY: '0px',
            scale: '1',
            rotate: '0deg'
          })
        }
      }
    }

    // Main
    return this.each(function () {
      ;(function (self) {
        var $self = $(self),
          source = self.src,
          imageLoad = new Image()

        imageLoad.src = source
        // if(imageLoad.complete){
        // 	imageLoaded(source, true);
        // }else{
        // 	$(imageLoad).load(function(){
        // 		imageLoaded(source, true);
        // 	});
        // }
        $(imageLoad).load(function () {
          imageLoaded(source, true)
        })
      })(this)
    })
  }
})(jQuery)
