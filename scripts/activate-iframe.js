;(function () {
  if (typeof ImageViewerUtils === 'object') return

  const imageUrls = []
  for (const img of document.getElementsByTagName('img')) {
    imageUrls.push(img.currentSrc)
  }

  for (const node of document.querySelectorAll('*')) {
    const bg = window.getComputedStyle(node).backgroundImage
    if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
      imageUrls.push(bg.substring(4, bg.length - 1).replace(/['"]/g, ''))
    }
  }

  for (const img of document.querySelectorAll('video[poster]')) {
    imageUrls.push(img.poster)
  }

  return [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank')
})()
