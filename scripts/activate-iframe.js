;(async function () {
  if (typeof ImageViewerUtils === 'object') return

  const {options} = await chrome.runtime.sendMessage('get_options')
  const asyncList = []
  for (const img of document.getElementsByTagName('img')) {
    if (img.clientWidth < options.minWidth || img.clientHeight < options.minHeight) continue
    asyncList.push(
      new Promise(resolve => {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')

        c.width = img.naturalWidth
        c.height = img.naturalHeight

        img.crossOrigin = 'anonymous'
        img.onload = () => {
          ctx.drawImage(img, 0, 0)
          const url = img.src.match('png') ? c.toDataURL() : c.toDataURL('image/jpeg')
          resolve(url)
        }
        if (img.complete) {
          ctx.drawImage(img, 0, 0)
          const url = img.src.match('png') ? c.toDataURL() : c.toDataURL('image/jpeg')
          resolve(url)
        }
      })
    )
  }
  const imageDataUrls = await Promise.all(asyncList)
  return imageDataUrls
})()
