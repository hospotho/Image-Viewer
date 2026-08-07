;(function () {
  'use strict'

  async function createNotes() {
    const rawText = await fetch('../version.txt').then(res => res.text())
    const data = rawText.replaceAll('\r', '').split('\n\n').map(t => t.trim().split('\n'))

    const noteContainerGroup = document.createElement('div')
    noteContainerGroup.classList.add('note-container-group')
    for (const textList of data) {
      const noteContainer = document.createElement('div')
      noteContainer.classList.add('note-container')

      const bar = document.createElement('button')
      bar.classList.add('bar')
      bar.type = 'button'
      bar.textContent = textList.shift()

      const noteText = document.createElement('div')
      noteText.classList.add('noteText')
      for (const line of textList) {
        const p = document.createElement('p')
        p.textContent = line
        noteText.appendChild(p)
      }

      bar.onclick = () => {
        if (noteContainer.classList.contains('active')) {
          noteContainer.classList.remove('active')
          noteText.style.maxHeight = null
        } else {
          noteContainer.classList.add('active')
          noteText.style.maxHeight = noteText.scrollHeight + 'px'
        }
      }

      noteContainer.appendChild(bar)
      noteContainer.appendChild(noteText)
      noteContainerGroup.appendChild(noteContainer)
    }
    document.body.appendChild(noteContainerGroup)

    // toggle first note
    const firstNote = document.querySelector('div.note-container-group > div:nth-child(1) > button')
    firstNote.nextElementSibling.style.transitionDuration = '0s'
    firstNote.click()
    setTimeout(() => (firstNote.nextElementSibling.style.transitionDuration = ''), 100)
  }

  function i18n() {
    chrome.i18n.getAcceptLanguages(languages => {
      const exist = ['en', 'ja', 'zh_CN', 'zh_TW']
      let displayLanguages = 'en'
      for (const lang of languages) {
        if (exist.includes(lang.replace('-', '_'))) {
          displayLanguages = lang
          break
        }
        if (exist.includes(lang.slice(0, 2))) {
          displayLanguages = lang.slice(0, 2)
          break
        }
      }
      document.documentElement.setAttribute('lang', displayLanguages)
    })

    for (const el of document.querySelectorAll('[data-i18n]')) {
      const tag = el.getAttribute('data-i18n')
      const message = chrome.i18n.getMessage(tag)
      if (!message) continue
      el.textContent = message
      if (el.value !== '') el.value = message
    }
  }

  function init() {
    createNotes()
    i18n()
  }

  init()
})()
