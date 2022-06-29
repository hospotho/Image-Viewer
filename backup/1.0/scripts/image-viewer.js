const imageViewer = (function () {
  const appName = '__crx__image-viewer'
  const imageListName = '__crx__image-list'

  //==========utility==========
  function strToNode(str) {
    var template = document.createElement('template')
    template.innerHTML = str.trim()
    return template.content.firstChild
  }

  function closeImageViewer() {
    document.documentElement.classList.remove('has-image-viewer')
    var viewer = document.querySelector(`div.${appName}`)
    viewer.addEventListener('transitionend', () => viewer.remove())
    viewer.style.transition = 'opacity 0.1s'
    viewer.style.opacity = '0'
    return
  }

  //==========function define==========
  function buildApp() {
    //==========build frame==========
    document.documentElement.classList.add('has-image-viewer')
    const frame = `<div class="${appName}">
  <ul class="${imageListName}"></ul>
  <nav class="${appName}-control">
    <div class="${appName}-relate">
      <ul>
        <li><button class="${appName}-control-prev">Previous</button></li>
        <li><button class="${appName}-control-next">Next</button></li>
      </ul>
      <p class="${appName}-relate-counter"><span class="${appName}-relate-counter-current">1</span>/<span class="${appName}-relate-counter-total">1</span></p>
    </div>
    <ul class="${appName}-control-buttons">
      <li><button data-fit="both" class="${appName}-control-button-both"></button></li>
      <li><button data-fit="width" class="${appName}-control-button-width"></button></li>
      <li><button data-fit="height" class="${appName}-control-button-height"></button></li>
      <li><button data-fit="none" class="${appName}-control-button-none"></button></li>
      <li><button class="${appName}-button-moveto"></button></li>
    </ul>
    <ul class="${appName}-info">
      <li>
        <span class="label"><span data-i18n="width">Width</span>: </span><input class="${appName}-info-width" />
      </li>
      <li>
        <span class="label"><span data-i18n="height">Height</span>: </span><input class="${appName}-info-height" />
      </li>
    </ul>
  </nav>
  <button class="${appName}-button-close">Close</button>
</div>
`
    document.body.appendChild(strToNode(frame))
    try {
      for (const node of document.querySelectorAll(`.${appName} [data-i18n]`)) {
        var msg = chrome.i18n.getMessage(node.getAttribute('data-i18n'))
        if (!msg) break
        node.innerHTML = msg
        if (node.value !== '') node.value = msg
      }
    } catch (e) {}
  }

  function buildImageList(imageList) {
    const _imageList = document.querySelector(`.${appName} .${imageListName}`)
    let first = `<li class="${appName}-list-0 current"><img src="${imageList[0]}" alt="" /></li>`
    _imageList.appendChild(strToNode(first))
    document.querySelector(`.${appName}-info-width`).value = _imageList.querySelector('li img').naturalWidth
    document.querySelector(`.${appName}-info-height`).value = _imageList.querySelector('li img').naturalHeight

    if (imageList.length === 1) return
    document.querySelector(`.${appName}-relate`).style.display = 'inline'
    document.querySelector(`.${appName}-relate-counter-total`).innerHTML = imageList.length
    for (let i = 1; i < imageList.length; i++) {
      const html = `<li class="${appName}-list-${i}"><img src="${imageList[i]}" alt="" /></li>`
      _imageList.appendChild(strToNode(html))
    }
  }

  function fitImage(options) {
    function both(imageWidth, imageHeight) {
      const windowWidth = document.documentElement.clientWidth
      const windowHeight = document.documentElement.clientHeight
      const windowRatio = windowWidth / windowHeight
      const imgRatio = imageWidth / imageHeight
      return imgRatio >= windowRatio ? [windowWidth, windowWidth / imgRatio] : [windowHeight * imgRatio, windowHeight]
    }
    function width(imageWidth, imageHeight) {
      const windowWidth = document.documentElement.clientWidth
      const windowHeight = document.documentElement.clientHeight
      const imgRatio = imageWidth / imageHeight
      return [windowWidth, windowWidth / imgRatio]
    }
    function height(imageWidth, imageHeight) {
      const windowWidth = document.documentElement.clientWidth
      const windowHeight = document.documentElement.clientHeight
      const imgRatio = imageWidth / imageHeight
      return [windowHeight * imgRatio, windowHeight]
    }
    function none(imageWidth, imageHeight) {
      return [imageWidth, imageHeight]
    }
    const dict = {both: both, width: width, height: height, none: none}
    const fitFunc = dict[options.fitMode] || both
    const action = img => {
      const [w, h] = fitFunc(img.naturalWidth, img.naturalHeight)
      img.width = w
      img.height = h
      img.style.marginLeft = `${-w / 2}px`
      img.style.marginTop = `${-h / 2}px`
      img.style.transform = ''
    }
    document.querySelectorAll(`.${appName} .${imageListName} li`).forEach(li => {
      const img = li.firstChild
      img.addEventListener('load', e => action(e.target))
      if (img.naturalWidth) action(img)
      const event = new CustomEvent('resetDrag')
      li.dispatchEvent(event)
    })
  }

  function addFrameEvent(options) {
    //Fit button
    const currFitBtn = document.querySelector(`.${appName}-control-button-${options.fitMode}`)
    currFitBtn?.classList.add('on')
    for (const fitBtn of document.querySelectorAll(`.${appName}-control-buttons button[data-fit]`)) {
      fitBtn.addEventListener('click', e => {
        document.querySelectorAll(`.${appName}-control-buttons button`).forEach(btn => btn.classList.remove('on'))
        e.target.classList.add('on')
        var newOptions = options
        newOptions.fitMode = e.target.getAttribute('data-fit')
        fitImage(newOptions)
      })
    }
    //MoveTo button
    document.querySelector(`.${appName}-button-moveto`).addEventListener('click', () => {
      var imgUrl = document.querySelector('.current img').src
      for (const img of document.querySelectorAll('img')) {
        if (imgUrl === img.src) {
          console.log('moveto')
          img.scrollIntoView({block: 'center'})
          break
        }
      }
      closeImageViewer()
    })
    // Close button
    if (!options.closeButton) return
    const closeButton = document.querySelector('.' + appName + ' .' + appName + '-button-close')
    closeButton.classList.add('show')
    closeButton.addEventListener('click', closeImageViewer)
    closeButton.addEventListener('contextmenu', close)
  }

  function addImageEvent(options) {
    //resize
    window.addEventListener('resize', e => {
      fitImage(options)
    })

    //transform
    document.querySelectorAll(`.${appName}  .${imageListName} li`).forEach(li => {
      const img = li.firstChild
      //zoom
      li.addEventListener('wheel', e => {
        e.preventDefault()
        if (e.altKey) return
        const match = img.style.transform.match(/scale\((\d+\.\d+)\)/)
        const scale = match ? Number(match[1]) : 1
        img.style.transform = img.style.transform.replace(/(scale\(\d+\.?\d*\))/, '')
        img.style.transform += e.deltaY > 0 ? ` scale(${scale / options.zoomRatio})` : ` scale(${scale * options.zoomRatio})`
        img.style.transform = img.style.transform.replace(/\s+/g, ' ').trim()
      })
      //rotate
      li.addEventListener('wheel', e => {
        e.preventDefault()
        if (!e.altKey) return
        const match = img.style.transform.match(/rotate\((.+)deg\)/)
        const rotate = match ? Number(match[1]) : 0
        img.style.transform = img.style.transform.replace(/(rotate\(.+deg\))/, '')
        img.style.transform += e.deltaY > 0 ? ` rotate(${rotate - options.rotateDeg}deg)` : ` rotate(${rotate + options.rotateDeg}deg)`
        img.style.transform = img.style.transform.replace(/\s+/g, ' ').trim()
      })
      //mirror-reflect
      li.addEventListener('click', e => {
        if (!e.altKey) return
        if (img.classList.contains('mirror')) {
          img.classList.remove('mirror')
          img.style.transform = img.style.transform.replace('scaleX(-1)', '')
        } else {
          img.classList.add('mirror')
          img.style.transform += ' scaleX(-1)'
        }
        img.style.transform = img.style.transform.replace(/\s+/g, ' ').trim()
      })
      //dragging
      var dragFlag = false
      var imagePos = {x: 0, y: 0}
      var startPos = {x: 0, y: 0}
      li.addEventListener('mousedown', e => {
        dragFlag = true
        startPos = {x: e.clientX - imagePos.x, y: e.clientY - imagePos.y}
      })
      li.addEventListener('mousemove', e => {
        if (!dragFlag) return
        img.style.transform = img.style.transform.replace(/translateX\(-?\d+px\) translateY\(-?\d+px\)/, '')
        img.style.transform += ` translateX(${e.clientX - startPos.x}px) translateY(${e.clientY - startPos.y}px)`
        img.style.transform = img.style.transform.replace(/\s+/g, ' ').trim()
      })
      li.addEventListener('mouseup', e => {
        dragFlag = false
        imagePos = {
          x: e.clientX - startPos.x,
          y: e.clientY - startPos.y
        }
      })
      li.addEventListener('resetDrag', e => {
        imagePos = {x: 0, y: 0}
        startPos = {x: 0, y: 0}
      })
      //reset
      li.addEventListener('dblclick ', e => {
        img.style.transform = ''
        imagePos = {x: 0, y: 0}
        startPos = {x: 0, y: 0}
      })
    })
  }

  function addImageListEvent() {
    const imageListNode = document.querySelector(`.${appName} .${imageListName}`)
    const imageList = imageListNode.querySelectorAll('li')

    //function
    var debounceTimeout
    function prevItem() {
      clearTimeout(debounceTimeout)
      const currentListItem = imageListNode.querySelector('li.current')
      const currentIndex = [...imageList].indexOf(currentListItem)

      const prevIndex = currentIndex === 0 ? imageList.length - 1 : currentIndex - 1
      document.querySelector(`.${appName}-relate-counter-current`).innerHTML = prevIndex + 1
      const relateListItem = imageListNode.querySelector(`li:nth-child(${prevIndex + 1})`)
      currentListItem.classList.remove('current')
      relateListItem.classList.add('current')

      imageListNode.style.top = `${-prevIndex * 100}%`
      const relateImage = relateListItem.querySelector('img')
      document.querySelector(`.${appName}-info-width`).value = relateImage.naturalWidth
      document.querySelector(`.${appName}-info-height`).value = relateImage.naturalHeight
    }

    function nextItem() {
      const currentListItem = imageListNode.querySelector('li.current')
      const currentIndex = [...imageList].indexOf(currentListItem)

      const nextIndex = currentIndex === imageList.length - 1 ? 0 : currentIndex + 1
      const action = () => {
        document.querySelector(`.${appName}-relate-counter-current`).innerHTML = nextIndex + 1
        const relateListItem = imageListNode.querySelector(`li:nth-child(${nextIndex + 1})`)
        currentListItem.classList.remove('current')
        relateListItem.classList.add('current')

        imageListNode.style.top = `${-nextIndex * 100}%`
        const relateImage = relateListItem.querySelector('img')
        document.querySelector(`.${appName}-info-width`).value = relateImage.naturalWidth
        document.querySelector(`.${appName}-info-height`).value = relateImage.naturalHeight
      }

      if (nextIndex === 0) {
        clearTimeout(debounceTimeout)
        debounceTimeout = setTimeout(action, 1000)
      } else {
        action()
      }
    }

    //function key
    window.addEventListener('keydown', e => {
      if (e.code === 'ArrowRight' || e.code === 'ArrowDown') {
        return nextItem()
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
        return prevItem()
      }
      if (e.code === 'Escape' || e.code === '"NumpadAdd"') {
        return closeImageViewer()
      }
    })
    //arror button
    document.querySelector(`.${appName}-relate .${appName}-control-prev`).addEventListener('click', prevItem)
    document.querySelector(`.${appName}-relate .${appName}-control-next`).addEventListener('click', nextItem)
    //control bar
    document.querySelector(`.${appName}-control`).addEventListener('wheel', e => {
      e.preventDefault()
      e.deltaY > 0 ? nextItem() : prevItem()
    })
    //close button
    document.querySelector(`.${appName} .${appName}-button-close`).addEventListener('wheel', e => {
      e.preventDefault()
      e.deltaY > 0 ? nextItem() : prevItem()
    })
  }

  //==========main function==========
  function imageViewer(imageList, options = {}) {
    if (imageList.length === 0 || document.documentElement.classList.contains('has-image-viewer')) return
    console.log('Total image: ', imageList.length)
    buildApp()
    buildImageList(imageList)
    addFrameEvent(options)
    addImageEvent(options)
    if (imageList.length > 1) addImageListEvent()
    fitImage(options)
  }

  return imageViewer
})()
