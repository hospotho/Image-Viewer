;(async function () {
  if (typeof ImageViewerUtils === 'object') return

  const asyncList = []
  for (const img of document.getElementsByTagName('img')) {
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
