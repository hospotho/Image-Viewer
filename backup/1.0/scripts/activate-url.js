;(function () {
  'use strict'

  chrome.runtime.sendMessage('get_options', res => {
    if (!res) return
    var {options} = res

    var images = document.querySelectorAll('body img[src="' + location.href + '"]')
    if (images && images[0].src == location.href) {
      images[0].style.display = 'none'

      imageViewer([images[0].src], options)
    }
  })
})()
