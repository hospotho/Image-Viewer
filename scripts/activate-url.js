;(function () {
  'use strict'

  chrome.runtime.sendMessage('get_options', res => {
    if (!res) return
    var {options} = res
    options.closeButton = false
    options.minWidth = 0
    options.minHeight = 0

    var image = document.querySelector(`body img[src='${location.href}']`)
    if (image) {
      image.style.display = 'none'

      chrome.runtime.sendMessage('load_script', res => {
        imageViewer([image.src], options)
      })
    }
  })
})()
