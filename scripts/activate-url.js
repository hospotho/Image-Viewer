;(function () {
  'use strict'

  chrome.runtime.sendMessage('get_options', res => {
    if (!res) return
    var {options} = res
    options.closeButton = false

    var images = document.querySelectorAll('body img[src="' + location.href + '"]')
    if (images.length && images[0].src == location.href) {
      images[0].style.display = 'none'

      chrome.runtime.sendMessage('load_script', res => {
        imageViewer([images[0].src], options)
      })
    }
  })
})()
