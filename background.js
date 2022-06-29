//==========utility==========
const i18n = tag => chrome.i18n.getMessage(tag)

//==========storage==========
function resetOptions() {
  const defaultOptions = {fitMode: 'both', zoomRatio: 1.5, rotateDeg: 15, minWidth: 100, minHeight: 100}
  chrome.storage.sync.set({options: defaultOptions}, () => {
    console.log('Set options to default values.')
  })
}

function resetLocalStorage() {
  chrome.storage.sync.get('options', res => {
    if (res && Object.keys(res).length === 0 && Object.getPrototypeOf(res) === Object.prototype) {
      resetOptions()
      chrome.runtime.openOptionsPage()
    }
    console.log(res)
    console.log('Init comolete.')
  })
}

resetLocalStorage()

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request === 'get_options') {
    chrome.storage.sync.get('options', res => {
      var options = res
      sendResponse(options)
    })
    return true
  }
  sendResponse({})
})

//==========Tooltip==========
chrome.action.onClicked.addListener(tab => {
  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
})

//==========Context menu (right-click menu)==========
chrome.contextMenus.removeAll()
chrome.contextMenus.create({
  id: 'open_in_image_viewer',
  title: i18n('open_in_image_viewer'),
  contexts: ['image']
})
chrome.contextMenus.create({
  id: 'open_image_viewer',
  title: i18n('view_images_in_image_viewer'),
  contexts: ['page']
})
chrome.contextMenus.create({
  id: 'open_all_image_in_image_viewer',
  title: i18n('view_all_images_in_image_viewer'),
  contexts: ['action']
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'open_in_image_viewer':
      chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func: url => {
          chrome.storage.sync.get('options', res => {
            var {options} = res
            options.closeButton = true
            imageViewer([url], options)
          })
        },
        args: [info.srcUrl]
      })
      break
    case 'open_image_viewer':
      chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
      break
    case 'open_all_image_in_image_viewer':
      chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-all.js']})
      break
  }
})

//==========command==========
chrome.commands.onCommand.addListener(command => {
  console.log(`Command: ${command}`)
  if (command === 'open-image-viwer') {
    return
  }
  if (command === 'open-image-viwer-without-size-filter') {
    return
  }
})

// chrome.extension.onMessage.addListener((request ,sender, sendResponse) => {

// })
