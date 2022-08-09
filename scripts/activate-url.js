;(function () {
  'use strict'

  var image = document.querySelector(`body img[src='${location.href}']`)
  if (image) {
    chrome.runtime.sendMessage('get_options', res => {
      if (!res) return
      var {options} = res
      options.closeButton = false
      options.minWidth = 0
      options.minHeight = 0
      
      chrome.runtime.sendMessage('load_script', res => {
        image.style.display = 'none'
        imageViewer([image.src], options)
      })
    })
  }
})()
