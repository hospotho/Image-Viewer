;(function () {
  'use strict'

  // zip
  function generateCRCTable() {
    const crcTable = new Uint32Array(256)
    const polynomial = 0xedb88320 // CRC-32 polynomial

    for (let i = 0; i < 256; i++) {
      let crc = i
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crcTable[i] = crc
    }
    return crcTable
  }
  function calculateCRC32(data) {
    const crcTable = generateCRCTable()
    let crc = 0xffffffff // Initial CRC value

    for (let i = 0; i < data.length; i++) {
      const byte = data[i]
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
    }

    crc ^= 0xffffffff // Final XOR value
    const crcBytes = new Uint8Array(4)
    crcBytes[0] = (crc >> 24) & 0xff
    crcBytes[1] = (crc >> 16) & 0xff
    crcBytes[2] = (crc >> 8) & 0xff
    crcBytes[3] = crc & 0xff

    return crcBytes
  }

  function buildLocalFileHeader(filename, data) {
    const signature = 0x04034b50
    const versionNeeded = 20 // Minimum version needed to extract
    const generalPurposeFlag = 0 // No special flags
    const compressionMethod = 0 // No compression
    const modificationTime = 0 // Placeholder for modification time (not used)
    const modificationDate = 0 // Placeholder for modification date (not used)

    // Calculate CRC-32 checksum
    const crc32 = calculateCRC32(data)

    const compressedSize = data.length
    const uncompressedSize = data.length
    const filenameLength = filename.length
    const extraFieldLength = 0 // No extra fields

    // Construct the local file header
    const localFileHeader = new Uint8Array(30 + filenameLength + extraFieldLength + compressedSize)

    const view = new DataView(localFileHeader.buffer)
    let offset = 0

    view.setUint32(offset, signature, true) // Little-endian byte order
    offset += 4

    view.setUint16(offset, versionNeeded, true)
    offset += 2

    view.setUint16(offset, generalPurposeFlag, true)
    offset += 2

    view.setUint16(offset, compressionMethod, true)
    offset += 2

    view.setUint16(offset, modificationTime, true)
    offset += 2

    view.setUint16(offset, modificationDate, true)
    offset += 2

    view.setUint32(offset, crc32, true)
    offset += 4

    view.setUint32(offset, compressedSize, true)
    offset += 4

    view.setUint32(offset, uncompressedSize, true)
    offset += 4

    view.setUint16(offset, filenameLength, true)
    offset += 2

    view.setUint16(offset, extraFieldLength, true)
    offset += 2

    const encoder = new TextEncoder()
    const filenameBytes = encoder.encode(filename)
    localFileHeader.set(filenameBytes, offset)
    offset += filenameBytes.length

    localFileHeader.set(data, offset)

    return localFileHeader
  }
  function buildCentralDirectory(localFileHeader, offset) {
    const signature = 0x02014b50
    const versionMadeBy = 20 // Minimum version needed to extract
    const versionNeeded = 20 // Minimum version needed to extract
    const generalPurposeFlag = 0 // No special flags
    const compressionMethod = 0 // No compression
    const modificationTime = 0 // Placeholder for modification time (not used)
    const modificationDate = 0 // Placeholder for modification date (not used)

    const dataView = new DataView(localFileHeader.buffer)
    const crc32 = dataView.getUint32(14, true) // Get the CRC-32 from local file header
    const compressedSize = dataView.getUint32(18, true) // Get the compressed size from local file header
    const uncompressedSize = dataView.getUint32(22, true) // Get the uncompressed size from local file header
    const filenameLength = dataView.getUint16(26, true) // Get the filename length from local file header
    const extraFieldLength = dataView.getUint16(28, true) // Get the extra field length from local file header

    // Construct the central directory entry
    const centralDirectoryEntry = new Uint8Array(46 + filenameLength)
    const view = new DataView(centralDirectoryEntry.buffer)
    let centralOffset = offset

    view.setUint32(0, signature, true) // Little-endian byte order
    // view.setUint16(4, versionMadeBy, true)
    // view.setUint16(6, versionNeeded, true)
    // view.setUint16(8, generalPurposeFlag, true)
    // view.setUint16(10, compressionMethod, true)
    // view.setUint16(12, modificationTime, true)
    // view.setUint16(14, modificationDate, true)
    // view.setUint32(16, crc32, true)
    // view.setUint32(20, compressedSize, true)
    // view.setUint32(24, uncompressedSize, true)
    // view.setUint16(28, filenameLength, true)
    // view.setUint16(30, extraFieldLength, true)
    view.setUint16(32, 0, true) // No file comment
    view.setUint16(34, 0, true) // Disk number start
    view.setUint16(36, 0, true) // Internal file attributes
    view.setUint32(38, 0, true) // External file attributes
    view.setUint32(42, centralOffset, true)

    const localFileHeaderArray = new Uint8Array(localFileHeader.buffer)
    centralDirectoryEntry.set(localFileHeaderArray.subarray(4, 30 + filenameLength + extraFieldLength), 4)

    return centralDirectoryEntry
  }

  function buildZip(localFileHeaderList) {
    const centralDirectoryList = []
    let centralOffset = 0

    // Build central directory entries
    for (let i = 0; i < localFileHeaderList.length; i++) {
      const localFileHeader = localFileHeaderList[i]
      const centralDirectoryEntry = buildCentralDirectory(localFileHeader, centralOffset)
      centralDirectoryList.push(centralDirectoryEntry)
      centralOffset += localFileHeader.length
    }

    // Calculate the size of the central directory
    const centralDirectorySize = centralDirectoryList.reduce((total, entry) => total + entry.length, 0)

    // Build the end of central directory record
    const endOfCentralDirectoryRecord = new Uint8Array(22)
    const view = new DataView(endOfCentralDirectoryRecord.buffer)

    view.setUint32(0, 0x06054b50, true) // Signature
    view.setUint16(8, localFileHeaderList.length, true) // Number of central directory records on this disk
    view.setUint16(10, localFileHeaderList.length, true) // Total number of central directory records
    view.setUint32(12, centralDirectorySize, true) // Size of central directory
    view.setUint32(16, centralOffset, true) // Offset of start of central directory

    // Combine all the components into the final zip file
    const zipSize = centralOffset + centralDirectorySize + endOfCentralDirectoryRecord.length
    const zipFile = new Uint8Array(zipSize)

    let offset = 0
    for (const localFileHeader of localFileHeaderList) {
      zipFile.set(localFileHeader, offset)
      offset += localFileHeader.length
    }

    for (const centralDirectoryEntry of centralDirectoryList) {
      zipFile.set(centralDirectoryEntry, offset)
      offset += centralDirectoryEntry.length
    }

    zipFile.set(endOfCentralDirectoryRecord, offset)

    return zipFile
  }

  // utility
  function getUserSelection(length) {
    if (length === 1) return [true]

    const userSelection = prompt("eg. '1-5, 8, 11-13'", `1-${length}`)
    if (!userSelection) return null

    const input = userSelection.replaceAll(' ', '')
    const regex = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/
    if (!regex.test(input)) {
      alert('Invalid selection.')
      return null
    }

    const result = new Array(length).fill(false)
    const processedInput = input.split(',')
    for (const part of processedInput) {
      if (part.includes('-')) {
        const [start, end] = part
          .split('-')
          .map(Number)
          .map(n => Math.min(Math.max(1, n), length) - 1)
          .sort((a, b) => a - b)
        for (let i = start; i <= end; i++) {
          ;``
          result[i] = true
        }
      } else {
        const index = Math.min(Math.max(1, Number(part)), length) - 1
        result[index] = true
      }
    }

    return result
  }
  function getImageBinary(url) {
    return fetch(url)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => new Uint8Array(arrayBuffer))
  }

  // main
  async function main() {
    const imageList = imageViewer()
    if (imageList.length === 0) return

    const imageUrlList = imageList.map(i => (typeof i === 'string' ? i : i[0]))
    const selectionRange = getUserSelection(imageUrlList.length)
    if (!imageUrlList.length || selectionRange === null) return

    const imageBinaryList = await Promise.all(imageUrlList.map(getImageBinary))

    const localFileHeaderList = []
    for (let i = 0; i < imageUrlList.length; i++) {
      if (!selectionRange[i]) continue

      const index = ('0000' + (i + 1)).slice(-5)
      const name = imageUrlList[i].startsWith('data') ? '' : '_' + imageUrlList[i].split('/').pop().split('?').shift()
      const filename = `${index}${name}` + (name.includes('.') ? '' : '.jpg')
      const data = imageBinaryList[i]

      const localFileHeader = buildLocalFileHeader(filename, data)
      localFileHeaderList.push(localFileHeader)
    }
    const zip = buildZip(localFileHeaderList)
    const blob = new Blob([zip.buffer])

    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob, 'application/zip')
    a.download = 'image.zip'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  main()
})()
