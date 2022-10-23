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

        if (img.complete && img.crossOrigin === 'anonymous') {
          ctx.drawImage(img, 0, 0)
          const url = img.src.match('png') ? c.toDataURL() : c.toDataURL('image/jpeg')
          resolve(url)
        }

        const src = img.src
        const cros = img.crossOrigin
        const style = img.getAttribute('style')

        img.onload = () => {
          if (img.crossOrigin !== 'anonymous') return
          ctx.drawImage(img, 0, 0)
          const url = img.src.match('png') ? c.toDataURL() : c.toDataURL('image/jpeg')
          img.src = src + '#' + new Date().getTime()
          img.crossOrigin = cros
          img.setAttribute('style', style)
          resolve(url)
        }
        img.onerror = () => {
          if (img.crossOrigin === cros) return
          img.src = src + '#' + new Date().getTime()
          img.crossOrigin = cros
          img.setAttribute('style', style)
          console.log(new URL(src).hostname + ' block your access outside iframe')
          resolve('')
        }
        img.setAttribute('crossorigin', 'anonymous')
        setTimeout(() => resolve(''), 3000)
      })
    )
  }
  const imageDataUrls = (await Promise.all(asyncList)).filter(url => url !== '')
  return imageDataUrls.length ? imageDataUrls : null
})()
