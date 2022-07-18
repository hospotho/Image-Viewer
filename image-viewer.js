const imageViewer = (function () {
  const appName = '__crx__image-viewer'
  const imageListName = '__crx__image-list'
  var shadowRoot

  //==========utility==========
  function strToNode(str) {
    var template = document.createElement('template')
    template.innerHTML = str.trim()
    return template.content.firstChild
  }

  function closeImageViewer() {
    document.documentElement.classList.remove('has-image-viewer')
    var viewer = document.querySelector('.__shadow__image-viewer')
    viewer.addEventListener('transitionend', () => viewer.remove())
    viewer.style.transition = 'opacity 0.1s'
    viewer.style.opacity = '0'
    return
  }

  function VtoM(scaleX, scaleY, rotate, moveX, moveY) {
    const m = [0, 0, 0, 0, 0, 0]
    const deg = Math.PI / 180
    m[0] = scaleX * Math.cos(rotate * deg)
    m[1] = scaleY * Math.sin(rotate * deg)
    m[2] = -scaleX * Math.sin(rotate * deg)
    m[3] = scaleY * Math.cos(rotate * deg)
    m[4] = moveX
    m[5] = moveY
    return `matrix(${m.map(t => t.toFixed(2))})`
  }

  function MtoV(str) {
    const match = str.match(/matrix\([-\d\.e, ]+\)/)
    if (!match) return
    const m = match[0]
      .slice(7, -1)
      .split(',')
      .map(t => Number(t))
    //https://www.w3.org/TR/css-transforms-1/#decomposing-a-2d-matrix
    var row0x = m[0]
    var row0y = m[2]
    var row1x = m[1]
    var row1y = m[3]
    const moveX = m[4]
    const moveY = m[5]
    var scaleX = Math.sqrt(row0x * row0x + row0y * row0y)
    var scaleY = Math.sqrt(row1x * row1x + row1y * row1y)
    const determinant = row0x * row1y - row0y * row1x
    if (determinant < 0) {
      scaleX = -scaleX
    }
    if (determinant === 0) {
      scaleX = 1
      scaleY = 1
    }
    if (scaleX) {
      row0x *= 1 / scaleX
      row0y *= 1 / scaleX
    }
    if (scaleY) {
      row1x *= 1 / scaleY
      row1y *= 1 / scaleY
    }
    var rotate = Math.atan2(row0y, row0x)
    return [scaleX, scaleY, (rotate / Math.PI) * 180, moveX, moveY]
  }

  const frame = () => {
    return `<ul class="${imageListName}"></ul>
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
    <button class="${appName}-button-close">Close</button>`
  }

  const style = () => {
    return `* {
        user-select: none;
        -webkit-user-drag: none;
      }
      .__crx__image-viewer * {
        margin: 0;
        padding: 0;
        transition: 0s;
      }
      .__crx__image-viewer {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 2147483647;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8) !important;
      }
      .__crx__image-viewer,
      .__crx__image-viewer input {
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 1em;
      }
      .__crx__image-viewer .__crx__image-list {
        width: 100%;
        height: 100%;
        padding: 0;
        margin: 0;
        position: absolute;
        left: 0;
        top: 0;
      }
      .__crx__image-viewer .__crx__image-list li {
        cursor: move;
        width: 100%;
        height: 100%;
        list-style: none;
        position: relative;
        overflow: hidden;
      }
      .__crx__image-viewer .__crx__image-list li img {
        position: absolute;
        left: 50%;
        top: 50%;
      }      
      .__crx__image-viewer .__crx__image-viewer-control {
        position: fixed;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 60px;
        background: rgba(0, 0, 0, 0);
        border-top: 0px #333 solid;
      }
      .__crx__image-viewer .__crx__image-viewer-control * {
        visibility: hidden;
      }
      .__crx__image-viewer .__crx__image-viewer-control:hover,
      .__crx__image-viewer .__crx__image-viewer-control:hover * {
        background: rgba(0, 0, 0, 0.8);
        visibility: visible;
      }      
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info {
        position: absolute;
        right: 10px;
        top: 0;
        margin-top: 5px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info li {
        list-style: none;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info .label {
        display: inline-block;
        width: 70px;
        text-align: right;
        margin-right: 5px;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 16px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info input {
        background: none;
        border: 1px transparent dashed;
        border-radius: 5px;
        width: 70px;
        text-align: center;
        padding: 0 5px;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 16px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-info input:hover {
        border-color: #aaa;
      }      
      .__crx__image-viewer .__crx__image-viewer-button-close {
        display: none;
        position: absolute;
        right: -50px;
        top: -50px;
        cursor: pointer;
        width: 100px;
        height: 100px;
        border: 0;
        white-space: nowrap;
        text-indent: 150%;
        overflow: hidden;
        background: #fff;
        opacity: 0.8;
        border-radius: 50%;
        box-shadow: inset 0 0 0 #fff;
      }
      .__crx__image-viewer .__crx__image-viewer-button-close.show {
        display: block;
      }
      .__crx__image-viewer .__crx__image-viewer-button-close:before,
      .__crx__image-viewer .__crx__image-viewer-button-close:after {
        content: '';
        display: block;
        position: absolute;
        left: 50%;
        top: 50%;
        margin-left: -20px;
        margin-top: 5px;
        background: #999;
        width: 5px;
        height: 30px;
      }
      .__crx__image-viewer .__crx__image-viewer-button-close:before {
        transform: rotate(-45deg);
      }
      .__crx__image-viewer .__crx__image-viewer-button-close:after {
        transform: rotate(45deg);
      }      
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate {
        position: absolute;
        left: 10px;
        top: 0;
        margin-top: 5px;
        display: none;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate .__crx__image-viewer-relate-counter,
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate .__crx__image-viewer-relate-counter span {
        display: inline-block;
        font-family: Verdana, Helvetica, Arial, sans-serif;
        color: #ddd;
        font-size: 16px;
        visibility: visible;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate ul {
        display: inline-block;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li {
        list-style: none;
        display: inline-block;
        width: 50px;
        margin: 0 5px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button {
        cursor: pointer;
        width: 50px;
        height: 50px;
        border: 0;
        white-space: nowrap;
        text-indent: 150%;
        overflow: hidden;
        position: relative;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 5px;
        box-shadow: inset 0 0 2px #fff;
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button:hover {
        box-shadow: inset 0 0 10px #fff;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button:active,
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button.on {
        box-shadow: inset 0 0 20px #fff;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li button:after {
        content: '';
        position: absolute;
        top: 50%;
        margin-top: -12px;
        display: block;
        width: 0px;
        height: 0px;
        border-style: solid;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li .__crx__image-viewer-control-prev:after {
        left: 50%;
        margin-left: -10px;
        border-width: 12px 18px 12px 0;
        border-color: transparent #787878 transparent transparent;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-relate li .__crx__image-viewer-control-next:after {
        right: 50%;
        margin-right: -10px;
        border-width: 12px 0 12px 18px;
        border-color: transparent transparent transparent #787878;
      }      
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons {
        margin: 5px auto 0;
        width: 330px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li {
        list-style: none;
        display: inline-block;
        width: 50px;
        margin: 0 5px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button {
        cursor: pointer;
        width: 50px;
        height: 50px;
        border: 0;
        white-space: nowrap;
        text-indent: 150%;
        overflow: hidden;
        position: relative;
        border-radius: 5px;
        box-shadow: inset 0 0 2px #fff;
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button:after {
        content: attr(data-tooltip);
        position: absolute;
        top: -50px;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button:hover {
        box-shadow: inset 0 0 10px #fff;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button:active,
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li button.on {
        box-shadow: inset 0 0 20px #fff;
      }      
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-control-button-both {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCQ0YxQUQ0NEM2NTAxMUUxQjgzRUY4RjM0QUVGODRFQyIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCQ0YxQUQ0M0M2NTAxMUUxQjgzRUY4RjM0QUVGODRFQyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8++nwS+AAABB1JREFUeNrsnUtoE0EcxicaRaFKQQ8+oHqoGlvwcfNoRVBP2ouIl9ZLDz4OVqkGi1ZaWInaiyIiHrxo9eDjpMWL4llRRG2LIthDLVghYqk1BOM37ERimmQ3uzObbPJ98DFtMrPJ/n/7n53N7uxGMpmMoKpH8xgCAqEIhEAoj4qGfQXi8XgERQLusSwrwwypvPbDJ1UZekXCPOxFdixCMQKvhb/AMWTJLDOkcjquYEitgbuZIZXLjhUoxuClOS//hNcjSyaZIcGrPw+G1BL4K7us4LNjM4pDJd7fQiDBahCe7/A+gQSUHXtR7HCo1oZ6+wjEPIwFKC66rJ5A/YUEYlZH4XUu68p6RzjsNZcdy1B8ghvLaJaEmzEM/s4M0a++MmEIVb+PGaI/OzaieCu8/RiahjchS0aYIfp0WXj/ZTqq2jNDAsicgl8e2RDhcQhFIARCEQiBUARCEQiBUARCIBSBEAhFIARCEQhFIARCEQiBUD4VZQj8KR6P+2pvWZaZDMEXa4Gf1CETuc4tVZMhgLAcxXm4q04zbje8E74Bn4OnKgJEXch8DO4V5V9RWItd/2H4IDwAX4FTge3UAaMdxXv4EmH8p0YVExmbduMZAhBbhT0ZZjtjX1LN8AP4ubAnor7WCgQgVqpU7PSSVWOjo3Ne2xCLaa1XTZ+bI7nhvoRvqa7dcf5jyUtJAWKxInwabuCG70vT8AXVw/wqNuyNFgEhr409oBbQxFhqUYPqZbrUBn4XzrjdqUuKdwjDiJpUbAfLGWV1qyHcOOOnXeMqtt2ugci76sBD+DOmdkbTjKOWfUiviulQoe7KcaeeN8qaYEx9aVWhUZarnXqBRnJBETfHIZ0dHRHTQ81svWITdrLfwdTn5m2spbZoM8chOWDkgtvUkXpCHQA5fulC0l3PbRuTn5sjOVu4B34YyE8nACM/qFXYNw5Lsjf6p6SKSasXGJ6BKCgpWE6mlBP0rwl7tmu9Kq1iIGMhY5LyuiDf50MAZQqWd0yQd+gZrkMYw2rdZQym/C5M2/kLQPmAYk8dAtG6zjynXmXiOXX/PYNghtSwCIRAKAIhEIpACIQiEAKhCIRAKAKhCIRAKAIhEIpACIQikHpWWJ6O8Fj4u7rjqWVZu5gh+nRCeL8QL63as8vSJfXsj+sem99E+3cEol99ovzriH/AZ7lTN5Ml8jlS/WU2G0C7bwRiTlfhjy7rfhb2HRU47DWYJfKq8h6X1eUD738TiHkoj1A8c6j2AvXu88AwOMlpYn8c3ueReoBZ8kbYt6so9v4rAgleZ8Tc6dry/9UhXqfwAkEWTAr71h+5SuD1CQKpnOR8vuzdJsZFiB4gWZNAkA2zKE5luzD8PxN2ILUwg+oevA2+XQPrEu5Hr9aieIKKQCgCIRDKq/4KMACWrCf3M5jnFgAAAABJRU5ErkJggg==);
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-control-button-width {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpDMUY5QUJENEM2NTAxMUUxOUIyQ0IyMkFFREYxRUMyRCIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpDMUY5QUJEM0M2NTAxMUUxOUIyQ0IyMkFFREYxRUMyRCIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8++tXJrAAAAnNJREFUeNrsnM8rBGEch3ckpfbg4MLBiWwc5D9wcODoJhdOeyCXTbKlpNRKuCgHJyecOHL0BygnWuXkwGUPe1BqU+Pz1jeF/TG7M8tknqc+vZN2h/k+768xNZ7v+ymIDx2UACGAEIQAQhACCEEIIAQhgBBACEIAIQgBhCAEEIIQQAggBCGAEIQAQhACCEEIIAQQghBACEIAIQgBhCAEEAIIiTedlCAc+Xw+1PcLhUJ7Roj+sBHlMoFO3DWPxGaESEKvmk0lm9ARN6VMKkfKhlL6EyES0aVmWVlXepj6U4vKnLKlHCiVX1vUJWNGzZ2yi4wv9FhNXG1m2j5CJGJczb4yQe3rMqicK9dKTrmNVIhE9NlQXGhlVD0Uiz9+NpzJ/IvPNcB13Bvl2Kb2l0Zf8Oq9nkkius3wmpKm44fiVdm2Geat1ra3s4YIT82snWCAWkZC2maZrHXwM8UPuqg7iyfIaAsDVtv9ZnZZOdvCPVG/yHmy2uYCC9G85iunOszYYvRKHSNZQ9atpqfVpquGi/q3XdYzNQ1Ff7VdVqBFvcqX3Im8IPchC/Pz3n/d4lb7nGpSr0c3fR/itfJWUrtT37EboO/yvCR1+xpCHpVV5SJAZw//rxOdxP2iUWVFKTMbfVK2mowGkdHMLiuIlIqyp8Mh5VB5T7CId6uBq4WrSaXVE4V+HiIpJWVJh2PKVQJlXNm1uxqUwp4ssucXknKvZjqBQiK9Zp6pxwyPd7/HC0YIQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQggBCGAEEAIQgAhCAGEIAQQghBACCAEIYAQhABCEAIIQQggBBAScz4EGADyS6Iw76d4WwAAAABJRU5ErkJggg==);
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-control-button-height {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCOTg0RTgyNEM2NTAxMUUxQTRGQ0VBQ0ZFNDI0NzUwNSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCOTg0RTgyM0M2NTAxMUUxQTRGQ0VBQ0ZFNDI0NzUwNSIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+0DCtRAAAAndJREFUeNrsncFLFFEcx9/mBl0UoUvQIQ8aCVIdu8V2CU968u45L1YoixALBhMLdalDhw5ePPQPdOjQoXsgokgUgh5KECFRREWcvo99QSyxOzPNvPEtnw/8+O3OvCeuH76zs+vhV4nj2MDF4RJ/AoQAQhACGamG/gLq9XpFramai6IoJiHlM6V66nrwVEK+7VU6rqhtqIZUW6pbSskxCSmPWSfDckP1mISUl45ral9VA38dPlDdVEp2SIh/FttkWPpVP7lk+U/HHbXpDufvIsQvr1R9Xc4jxFM6JtQedFlW07pJ3tSLl3FZbV01kmD5N9WY3uBPSUhxzCSUYdy6RySkuHRcVfuuGkyx7ZdqWCnZIyH500gpw7j1DRKSfzpG1VZNti9Dz1S3lZINEpIfL032b6arbj8J8ZCcf/7ySkOFzyGAEIQAQhACCAGEIAQQghBACEIAIQgBhABCEAIIQQggBCGAEIQAQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQggBCGAEIQAQgAhCAGEIAQQghBACEIAIYAQhABCEAIIQQh4JJTpCB/Uxv/jR3yMoughCcmPJ6Y1diILZ24/l6y8cLM/3mbc/k771xCSPw3TGmGUhn3VM97Ui0mJnSO1mHLbc+3bRUhxvDGtcXhJ2FS95ra32JTYmYRzCZfbgfcn3Pb6uQ3+pFbrsOSzZNzng6E/7Nz08y7n+aTu8dK1orbU4fwXhPhnQXXYdsw+vx7wawpXiFKwo/ai7XBTx38gpDzswMht93jbBDRAsieFKA3HavN/LmF6fhS6kKoJn/eqe6rlHngtYY9e7UX4BxVCACEIgaz8FmAAavyUc1I71hUAAAAASUVORK5CYII=);
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-control-button-none {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpFMjlCMEFGMTRDQzZFMTExOEZFQUQ0QkNGMDJGMzg3NyIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpCNTE3QTJGNEM2NTAxMUUxOTdBNjg0RjY1RThFQ0QwMiIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpCNTE3QTJGM0M2NTAxMUUxOTdBNjg0RjY1RThFQ0QwMiIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUzOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUyOUIwQUYxNENDNkUxMTE4RkVBRDRCQ0YwMkYzODc3Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+EIJY5QAAASxJREFUeNrs3UEOgjAQQFFrvHRP0GMPrIkmQKG25f2lRqO80IEIMUXES/30tgmACAgQAQEiIEAEBIiACAgQAQEiIEAEBIiACAgQAQEiIEDUrM/RF+Sca689TR1uh6rvVEpJ9hBLloAA0XBDfTvA1iF/y6Bs3N6hHPYQS5aACAgQAXnEYW/HxYnDWHvITRAx8DnQVCDxz5M4IIa6gAAZunTyOSCNUYY97J3lPCRN8j3MECACAkRAgAgIEAEBIiACAkRAgAjI9M3yA9X2kh8XynWE8euxIUpH/2Hngtuid32uCow73qe6vbdOmyGWLAEB0m4GXjA/xh7qX4b8ow9712HdF4gsWUAEBIiACAgQAQEiIEAEBIiACAgQAQEiIEAEBIiACAgQAQGiS1oEGACl7SnD1JcJ0wAAAABJRU5ErkJggg==);
        background-size: cover;
      }
      .__crx__image-viewer .__crx__image-viewer-control .__crx__image-viewer-control-buttons li .__crx__image-viewer-button-moveto {
        background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IB2cksfwAAAAlwSFlzAAALEwAACxMBAJqcGAAACjZJREFUeJztXXvsHUUVpjxanrVAi6VICQjhISCvIiohEARK7AMRbMQKtVahCJ8RJaiUgIlAeQghoBFSpZQAISoC8ghqrAQp2JLQUpA3BQyggsUXIEKp58uZX3Lz692d2Z0zO3fv5Uu+v+7dPWfm7M7jnDNn11uvhwFgA+FewnOEVwlPFX5ImFu1wYN0+ljhLcL/Ctd28B/Cc4Xr59ZxYCCdvZXw98MMMZzzhRvl1rXv4Yap6z3GIN8VfjW3vn0P6eSjXGf7DEK+IhyfW+e+hnTwHYHGGOLpuXXuW3D1JPx7RYMszK1330I6dwvhexUNsiS33n0L6dxdKhqDfCK33n0L6dydaxjkyQR6jBBOFB4hnCKcJpwuPCaQ/P9Ud+1k4UfQxn2TKL15jSHrPiPZ67s39NvCF2o8GD7ynjOFoy30bQyi8N8qNvQnBjI3FV4g/GsCQ3RyjfDXwr0t+qoRiLI/r9jIqM2hXL+fcHGNNzOGzwgPseqzpBBFD8O6/qsirhKOi5BFY7zcoCE6+arwYMu+SwJRckOEuU74RM9BTc+vXDdG+GAmYwyR80rvzymi5AeEd3oac7Zwg5r35+LhV5mNMcRr+RBa96E5RMlthD/FumP7G8JvIsLTK9deDJ1gcxuD5PB8pGXfJYUou6PwJOFpwmOFW0Xe79PCdyp22hp3zf9K+E4H30W4g5R8SLiZVZ8lB9Qlv7FwROR9uM/4S0AHLRWeLPwEdFO3u3C3AO4+jLx2mvBhjzwab4pVfyWBMwKf5vs6nuh/C38p3BcVJ3P5/2jhYwFvAvcjprtqud8o4Y0e2VdbyjSFM8alJUML55HPV7gfXSE/Dngz+J+Ridq0ifBPJbKfTSE3GlAX/Jnwb9TeFB4eeL9T4B/TuYPeNHHbji55yMgPp5RfC6LUnsJ/BjzN5CPCLTz3m+yGurL7rBZu20DbNoJ6BYr0CH7rGwM03afKCui4knuNhoZ5y65/W3hEg+2bU6LLeU3pEQxR6qmKBrm84D703t4ccP2ZDbdvD+gyuesc1qQuXkAn31A/1hBvK7jPZQHXXpehjdu6IbKbPjc2rU8pRKHNKhqDXCeEC137+ybxJ4UTMrRxgvD1Ap1uaFqfUkAdflUN8tCwe+wkfN5zDWMu+2dqI1Nji1ZaP8qhUyGgGYtVDfJwx/V0Sv4x4JrpGds4u0Svebn06gpoPm9Vg6xw13LeuCng/9ERxoj2caFR5sUuXDFmgSg0roZBVrprvwj/ZpL5wqMytu+j0A1tkX475NKtK2oahP6pj8O/Olsl3CZj2/gGl8VgnsqlWyGgMZCqBuHG7xnPf2is4zO37QsoX/ktyKlfV4hSH6xhEB+5ovmWoY4jhVu6h2c8dF8xwXG7DvJgEXO7GLdf4NGRXuapVjqaIZFBFsFg3oDGN+ZBk8GXQT23TwufFT7nyGGRS27Gyl8UvoSwjS59cptb9KEpEhiEHRblwYUmXZyOdCFfvsHHWvWhKdwQYNVQHn07KFIf8suBT3ld3mHxBieB4RvCDjzBQB/GL1YnNAbDDLta9F0SoN4qqxuvNNCFm9Q/JzQGh6qTLPotGYwMwgyOsZF6cM9QNaW1Kr+BXs+IR/yQxVjKTpE60BhXJDTEa8JZRl2WFgYGOcxAh+monrcVSu7UD0BkOlNjQNwqK9pTKvfYG7p3KJPzH+hwxrfoB44XF5Bn6c8Xfl04qTWGGEKEQW5BZPoOdPe9NEAWT0j1fi6uBWoahM7F0syTALnkzwJkzbdqaysA9QtVMQbTe6LPWMg9vgT/Tvzm2LewdahoEE68sw1kMn/3LY+s5UicRNeTqGgQTpa1zod0yGNmve8EFV0wB1q1sVWAurBDjLHCYBKnG/1Wjxwm0c2wal/rII3/TIAxmEIT5f+Bbv7ODpg3LkSv76ZTgcMCyuPNa91Y/0kDWbPh3/wxe2UwlrfDAXXkrQqZNwxkjUdxotoQeUJ2R4u2tQ7QjPCFAca4S7hJpCwe9vyDRw534ocaNa9dgG7IzgoYyx9FZMaImzduCDB8byWrNQk3ib8dMG/sFSmHnBtgjF+gV6N3qQGNfYQUKzvVQNbHAuYNJi5sadG21gGa5X5vgDGuMpC1AzQzxDdv7GzRttbBjeVXBhiDy86o1Bgn626PnPcs3sJWwo3lJwcYg9mIe0bKojHmBRjjAqv2tQ7QZGOf74ibw+i0T+gZd1/6zr2DPIkzrfLpgLcjuuwr9CTvGx45zC7svWPITcANH3cFGIPHBWKdhqxs+huPHMZRjrZqX6vgjHEG/Js/5spGnY+AlrD4oUcW542vYYCdhlMDxnLuR/YzkMWyTb7DnkzdHFinYWj1nbMMZLHE7L88cjiHDWateOiJ2sUBxrgGkZ+dgEYaH/fI4VJ6N6v2ZQfUbc3kYxYRmyE8AXqubxY0Q/wr0CIvHJ9Z+/Z38J/5ux/xBcl4kNK3YKAec636IhugIdXzhE8EPOlVyZTK7SP144LhewHGuASR8ffsgKZUPh7wlNfl5wx0PBL+eeMeROZtZQc7C8UFUix4roGOu8Jf6YcZI+2exKGnRX15SjG8HfGTOCvOLffI4fL3KKt+yQJoLcOUxqAbfGKkjpw3LvfI4TDb7m/rQWPbPld1DFcLDzDQcy78mz+W2Gj9JM55I9VJUwaAPmWgI9M+fSFfJl9nq9hgAqgPaFkCQ7DzuMrZP3YEgVb68R0X4CQ+yahb8gF65qFsecshgrEDbggPFR7sntaDoPHqSa7TWbVgH+jBFxYWNlluQoso+2q1U//+8OCi/GwEA0YnIqNDTmR/3/PAkPyiQrtOKHUDNKxa9GUZzilnZNaPb6Av7ZOfndg4p55mgBZKKWroEuStL7U9/Js/niVv9+avE27+KGpsdDWECL1Gw7/Q4J7ps7l0TAJp0HcLGsuyD1HOvwidQsq8ck75Tl/MG51AcY4UD+E3fqbOGePEgHljYc6FRjKguLgWv3mRQx8upV/1GIO1qKLKZ/QsSgyysunhABplfNFjDObo7tukXo0CxY46rl4a+4IY1IO7yGMMblBnNqVTFkDLPnRrPMfwRqo/u3ljfsAkfkkT+mQFNOpW1AnRgaRAHSYHTOI8+bR1E/pkBbS8d5E7e5Vwu8TyGfnzxez5e/9kjPjgmUivSCh3LPxn/vjmRJ+8bRVQ/qlT7obNd+xQD+6d8DsNL2p6tZcd0uBDUJ7UQCcjD0wyxFv3c6cjnBHonqd34DmPIchFdeW1GtAA1ZKADmIOLov+Lu/CFV34SAcZyeNHVF4LkLPW3XNM7r7JBuhqyxcebYr84Er7I38xgFZwTl2JM4QcOpmKNFjzRjdAP8fjqzeSmue8b4wOSGccj3yftmYoebCqtoVAOmUm0pVK7UbKugz96E63ADTOzjwtnxvcgoznM5tlMI+YVQG0sDG/oOzLMK9rCJ4jjzofMnCAbuh4pPkUN8Yvhn7j/H5HVlxY6uED0H3Ob52BpwjH5W5bL+L/sdiFy+uT9dcAAAAASUVORK5CYII=);
        background-size: cover;
      }`
  }

  //==========function define==========
  function buildApp() {
    //==========build frame==========
    document.documentElement.classList.add('has-image-viewer')

    const shadowHolder = document.createElement('div')
    shadowHolder.classList.add('__shadow__image-viewer')
    shadowRoot = shadowHolder.attachShadow({mode: 'closed'})
    document.body.appendChild(shadowHolder)

    const stylesheet = document.createElement('style')
    stylesheet.innerHTML = style()
    const viewer = document.createElement('div')
    viewer.classList.add(appName)
    viewer.innerHTML = frame()

    shadowRoot.append(stylesheet)
    shadowRoot.append(viewer)

    try {
      for (const node of shadowRoot.querySelectorAll(`.${appName} [data-i18n]`)) {
        var msg = chrome.i18n.getMessage(node.getAttribute('data-i18n'))
        if (!msg) break
        node.innerHTML = msg
        if (node.value !== '') node.value = msg
      }
    } catch (e) {}
  }

  function buildImageList(imageList) {
    const _imageList = shadowRoot.querySelector(`.${appName} .${imageListName}`)
    let first = strToNode(`<li><img src="${imageList[0]}" alt="" referrerpolicy="no-referrer"/></li>`)
    _imageList.appendChild(first)

    if (imageList.length === 1) return
    shadowRoot.querySelector(`.${appName}-relate`).style.display = 'inline'
    shadowRoot.querySelector(`.${appName}-relate-counter-total`).innerHTML = imageList.length
    for (let i = 1; i < imageList.length; i++) {
      const li = strToNode(`<li><img src="${imageList[i]}" alt="" referrerpolicy="no-referrer"/></li>`)
      _imageList.appendChild(li)
    }
  }

  function initImageList(options) {
    const index = options.index || 0
    const base = shadowRoot.querySelectorAll(`.${appName} .${imageListName} li`)[index]
    base.classList.add('current')
    shadowRoot.querySelector(`.${appName}-relate-counter-current`).innerHTML = index + 1

    const imageListNode = shadowRoot.querySelector(`.${appName} .${imageListName}`)
    imageListNode.style.top = `${-index * 100}%`

    base.firstChild.addEventListener('load', e => {
      if (options.sizeCheck) {
        const minSize = Math.min(e.target.naturalWidth, e.target.naturalHeight)
        options.minWidth = Math.min(minSize, options.minWidth)
        options.minHeight = Math.min(minSize, options.minHeight)
        options.sizeCheck = false
      }
      shadowRoot.querySelector(`.${appName}-info-width`).value = e.target.naturalWidth
      shadowRoot.querySelector(`.${appName}-info-height`).value = e.target.naturalHeight

      const total = shadowRoot.querySelector(`.${appName}-relate-counter-total`)
      shadowRoot.querySelectorAll(`.${appName} .${imageListName} li img`).forEach(img => {
        img.addEventListener('load', e => {
          if (e.target.naturalWidth < options.minWidth || e.target.naturalHeight < options.minHeight) {
            e.target.parentNode.remove()
          }
          total.innerHTML = shadowRoot.querySelectorAll(`.${appName} .${imageListName} li`).length
        })
        img.addEventListener('error', e => {
          e.target.parentNode.remove()
          total.innerHTML = shadowRoot.querySelectorAll(`.${appName} .${imageListName} li`).length
        })
        if (img.complete && (img.naturalWidth < options.minWidth || img.naturalHeight < options.minHeight)) {
          img.parentNode.remove()
          total.innerHTML = shadowRoot.querySelectorAll(`.${appName} .${imageListName} li`).length
        }
      })
      fitImage(options)
    })
  }

  function fitImage(options) {
    if (options.sizeCheck) return
    function both(imageWidth, imageHeight) {
      const windowWidth = document.documentElement.clientWidth
      const windowHeight = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : document.body.clientHeight
      const windowRatio = windowWidth / windowHeight
      const imgRatio = imageWidth / imageHeight
      return imgRatio >= windowRatio ? [windowWidth, windowWidth / imgRatio] : [windowHeight * imgRatio, windowHeight]
    }
    function width(imageWidth, imageHeight) {
      const windowWidth = document.documentElement.clientWidth
      const imgRatio = imageWidth / imageHeight
      return [windowWidth, windowWidth / imgRatio]
    }
    function height(imageWidth, imageHeight) {
      const windowHeight = document.doctype ? document.documentElement.clientHeight : document.body.clientHeight
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
      img.style.transform = 'matrix(1,0,0,1,0,0)'
    }
    shadowRoot.querySelectorAll(`.${appName} .${imageListName} li`).forEach(li => {
      const img = li.firstChild
      img.addEventListener('load', e => action(e.target))
      if (img.naturalWidth) action(img)
      const event = new CustomEvent('resetDrag')
      li.dispatchEvent(event)
    })
  }

  function addFrameEvent(options) {
    //Fit button
    const currFitBtn = shadowRoot.querySelector(`.${appName}-control-button-${options.fitMode}`)
    currFitBtn?.classList.add('on')
    for (const fitBtn of shadowRoot.querySelectorAll(`.${appName}-control-buttons button[data-fit]`)) {
      fitBtn.addEventListener('click', e => {
        shadowRoot.querySelectorAll(`.${appName}-control-buttons button`).forEach(btn => btn.classList.remove('on'))
        e.target.classList.add('on')
        var newOptions = options
        newOptions.fitMode = e.target.getAttribute('data-fit')
        fitImage(newOptions)
      })
    }
    //MoveTo button
    shadowRoot.querySelector(`.${appName}-button-moveto`).addEventListener('click', () => {
      var imgUrl = shadowRoot.querySelector('.current img').src
      var element = null
      for (const img of document.querySelectorAll('img')) {
        if (imgUrl === img.src) {
          element = img
          break
        }
      }
      if (!element) {
        for (const video of document.querySelectorAll('video')) {
          if (imgUrl === video.poster) {
            element = video
            break
          }
        }
      }
      if (!element) {
        for (const node of document.querySelectorAll('*')) {
          const bg = window.getComputedStyle(node).backgroundImage
          if (imgUrl === bg?.substring(4, bg.length - 1).replace(/['"]/g, '')) {
            element = node
            break
          }
        }
      }
      closeImageViewer()
      if (!element) return
      element.scrollIntoView({block: 'center'})
      const temp = element.style.border
      element.style.border = '5px solid red'
      setTimeout(() => (element.style.border = temp), 1000)
    })
    //Close button
    if (!options.closeButton) return
    const closeButton = shadowRoot.querySelector('.' + appName + ' .' + appName + '-button-close')
    closeButton.classList.add('show')
    closeButton.addEventListener('click', closeImageViewer)
    closeButton.addEventListener('contextmenu', e => {
      e.preventDefault()
      window.close()
    })
  }

  function addImageEvent(options) {
    //resize
    window.addEventListener('resize', e => {
      fitImage(options)
    })

    //transform
    shadowRoot.querySelectorAll(`.${appName}  .${imageListName} li`).forEach(li => {
      const img = li.firstChild
      var zoomCount = 0
      var rotateCount = 0
      //zoom
      li.addEventListener('wheel', e => {
        e.preventDefault()
        if (e.altKey) return
        var [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        e.deltaY > 0 ? zoomCount-- : zoomCount++
        scaleX = Math.sign(scaleX) * options.zoomRatio ** zoomCount
        scaleY = Math.sign(scaleY) * options.zoomRatio ** zoomCount
        const mirror = Math.sign(scaleX) * Math.sign(scaleY)
        rotate = (mirror * options.rotateDeg * rotateCount) % 360
        img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
      })
      //rotate
      li.addEventListener('wheel', e => {
        e.preventDefault()
        if (!e.altKey) return
        var [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        const mirror = Math.sign(scaleX) * Math.sign(scaleY)
        mirror === 1 ? (e.deltaY > 0 ? rotateCount++ : rotateCount--) : e.deltaY > 0 ? rotateCount-- : rotateCount++
        rotate = (mirror * options.rotateDeg * rotateCount) % 360
        img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
      })
      //mirror-reflect
      li.addEventListener('click', e => {
        if (!e.altKey) return
        var [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        const mirror = Math.sign(scaleX) * Math.sign(scaleY)
        rotate = (mirror * options.rotateDeg * rotateCount) % 360
        rotateCount *= -1
        img.style.transform = VtoM(-scaleX, scaleY, rotate, moveX, moveY)
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
        var [scaleX, scaleY, rotate, moveX, moveY] = MtoV(img.style.transform)
        rotate = options.rotateDeg * rotateCount
        moveX = e.clientX - startPos.x
        moveY = e.clientY - startPos.y
        img.style.transform = VtoM(scaleX, scaleY, rotate, moveX, moveY)
      })
      li.addEventListener('mouseup', e => {
        dragFlag = false
        imagePos = {x: e.clientX - startPos.x, y: e.clientY - startPos.y}
      })
      li.addEventListener('resetDrag', e => {
        zoomCount = 0
        rotateCount = 0
        img.style.transform = 'matrix(1,0,0,1,0,0)'
        imagePos = {x: 0, y: 0}
        startPos = {x: 0, y: 0}
      })
      //reset
      li.addEventListener('dblclick', e => {
        zoomCount = 0
        rotateCount = 0
        img.style.transform = 'matrix(1,0,0,1,0,0)'
        imagePos = {x: 0, y: 0}
        startPos = {x: 0, y: 0}
      })
    })
  }

  function addImageListEvent() {
    //function
    const imageListNode = shadowRoot.querySelector(`.${appName} .${imageListName}`)
    var debounceTimeout
    var index = 0
    function prevItem() {
      clearTimeout(debounceTimeout)
      const imageList = imageListNode.querySelectorAll('li')
      const currentListItem = imageListNode.querySelector('li.current')
      var currentIndex = [...imageList].indexOf(currentListItem)
      if (currentIndex === -1) currentIndex = Math.max(index, imageList.length)

      const prevIndex = currentIndex === 0 ? imageList.length - 1 : currentIndex - 1
      index = prevIndex
      shadowRoot.querySelector(`.${appName}-relate-counter-current`).innerHTML = prevIndex + 1
      const relateListItem = imageListNode.querySelector(`li:nth-child(${prevIndex + 1})`)
      currentListItem?.classList.remove('current')
      relateListItem.classList.add('current')

      imageListNode.style.top = `${-prevIndex * 100}%`
      const relateImage = relateListItem.querySelector('img')
      shadowRoot.querySelector(`.${appName}-info-width`).value = relateImage.naturalWidth
      shadowRoot.querySelector(`.${appName}-info-height`).value = relateImage.naturalHeight
    }

    function nextItem() {
      const imageList = imageListNode.querySelectorAll('li')
      const currentListItem = imageListNode.querySelector('li.current')
      var currentIndex = [...imageList].indexOf(currentListItem)
      if (currentIndex === -1) currentIndex = Math.max(index, imageList.length)

      const nextIndex = currentIndex === imageList.length - 1 ? 0 : currentIndex + 1
      index = nextIndex
      const action = () => {
        shadowRoot.querySelector(`.${appName}-relate-counter-current`).innerHTML = nextIndex + 1
        const relateListItem = imageListNode.querySelector(`li:nth-child(${nextIndex + 1})`)
        currentListItem?.classList.remove('current')
        relateListItem.classList.add('current')

        imageListNode.style.top = `${-nextIndex * 100}%`
        const relateImage = relateListItem.querySelector('img')
        shadowRoot.querySelector(`.${appName}-info-width`).value = relateImage.naturalWidth
        shadowRoot.querySelector(`.${appName}-info-height`).value = relateImage.naturalHeight
      }

      if (nextIndex === 0) {
        clearTimeout(debounceTimeout)
        debounceTimeout = setTimeout(action, 1000)
      } else {
        action()
      }
    }

    //key event
    window.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        return nextItem()
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        return prevItem()
      }
      if (e.key === 'Escape' || e.key === '"NumpadAdd"') {
        e.preventDefault()
        return closeImageViewer()
      }
    })
    //arror button
    shadowRoot.querySelector(`.${appName}-relate .${appName}-control-prev`).addEventListener('click', prevItem)
    shadowRoot.querySelector(`.${appName}-relate .${appName}-control-next`).addEventListener('click', nextItem)
    //control bar
    shadowRoot.querySelector(`.${appName}-control`).addEventListener('wheel', e => {
      e.preventDefault()
      e.deltaY > 0 ? nextItem() : prevItem()
    })
    //close button
    shadowRoot.querySelector(`.${appName} .${appName}-button-close`).addEventListener('wheel', e => {
      e.preventDefault()
      e.deltaY > 0 ? nextItem() : prevItem()
    })
  }

  //==========main function==========
  function imageViewer(imageList, _options) {
    if (imageList.length === 0 || document.documentElement.classList.contains('has-image-viewer')) return
    var options = _options
    buildApp()
    buildImageList(imageList)
    initImageList(options)
    fitImage(options)
    addFrameEvent(options)
    addImageEvent(options)
    if (imageList.length > 1) addImageListEvent()
  }

  console.log('Image viewer initialized')
  return imageViewer
})()
