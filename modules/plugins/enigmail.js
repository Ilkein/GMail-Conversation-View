/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Thunderbird Conversations
 *
 * The Initial Developer of the Original Code is
 *  Jonathan Protzenko <jonathan.protzenko@gmail.com>
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Patrick Brunschwig <patrick@enigmail.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

var EXPORTED_SYMBOLS = [];

/*
 * A typical "Thunderbird conversations" plugin would be as follows:
 *
 * - An overlay.xul that overlays whatever is loaded at startup (say,
 *   messenger.xul), with a <script> in it that reads
 *
 *    Components.utils.import("resource://yourext/conv-plugin.js");
 *
 * - The main work will happen in conv-plugin.js. For instance:
 *
 *    var EXPORTED_SYMBOLS = [];
 *
 *    let hasConversations;
 *    try {
 *      Components.utils.import("resource://conversations/hook.js");
 *      hasConversations = true;
 *    } catch (e) {
 *      hasConversations = false;
 *    }
 *    if (hasConversations)
 *      registerHook({
 *        // your functions here
 *      });
 *
 * That way, your conv-plugin.js won't export anything and AMO won't bother you.
 */

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/Services.jsm"); // https://developer.mozilla.org/en/JavaScript_code_modules/Services.jsm
Cu.import("resource:///modules/StringBundle.js"); // for StringBundle
Cu.import("resource://conversations/stdlib/msgHdrUtils.js");
Cu.import("resource://conversations/stdlib/misc.js");
Cu.import("resource://conversations/stdlib/compose.js");
Cu.import("resource://conversations/misc.js");
Cu.import("resource://conversations/hook.js");
Cu.import("resource://conversations/log.js");

let strings = new StringBundle("chrome://conversations/locale/message.properties");

let Log = setupLogging("Conversations.Modules.Enigmail");

// This is an example of a "Thunderbird Conversations" plugin. This is how one
//  is expected to interact with the plugin. As an example, we add an extra
//  Enigmail compatibility layer to make sure we use Enigmail to decrypt
//  messages whenever possible.
// If you need to listen to more events (conversation loaded, conversation
//  wiped)... just ask!

// Enigmail support, thanks to Patrick Brunschwig!
let window = getMail3Pane();
let hasEnigmail;
try {
  Cu.import("resource://enigmail/enigmailCommon.jsm");
  Cu.import("resource://enigmail/commonFuncs.jsm");
  hasEnigmail = true;
  Log.debug("Enigmail plugin for Thunderbird Conversations loaded!");
} catch (e) {
  hasEnigmail = false;
  Log.debug("Enigmail doesn't seem to be installed...");
}

let enigmailSvc;
let global = this;
window.addEventListener("load", function () {
  if (hasEnigmail) {
    enigmailSvc = EnigmailCommon.getService(window);
    if (!enigmailSvc) {
      Log.debug("Error loading the Enigmail service. Is Enigmail disabled?\n");
      hasEnigmail = false;
    }
    try {
      let loader = Services.scriptloader;
      loader.loadSubScript("chrome://enigmail/content/enigmailMsgComposeOverlay.js", global);
      loader.loadSubScript("chrome://enigmail/content/enigmailMsgComposeHelper.js", global);
    } catch (e) {
      hasEnigmail = false;
      Log.debug("Enigmail script doesn't seem to be loaded. Error: " + e);
    }
  }
}, false);

function tryEnigmail(bodyElement, aMsgWindow, aMessage) {
  if (bodyElement.textContent.indexOf("-----BEGIN PGP") < 0)
    return null;

  Log.debug("Found inline PGP");

  var signatureObj       = new Object();
  var exitCodeObj        = new Object();
  var statusFlagsObj     = new Object();
  var keyIdObj           = new Object();
  var userIdObj          = new Object();
  var sigDetailsObj      = new Object();
  var errorMsgObj        = new Object();
  var blockSeparationObj = new Object();

  try {
    // extract text preceeding and/or following armored block
    var head = "";
    var tail = "";
    var msgText = bodyElement.textContent;
    var startOffset = msgText.indexOf("-----BEGIN PGP");
    var indentMatches = msgText.match(/\n(.*)-----BEGIN PGP/);
    var indent = "";
    if (indentMatches && (indentMatches.length > 1)) {
      indent = indentMatches[1];
    }
    head = msgText.substring(0, startOffset).replace(/^[\n\r\s]*/,"");
    head = head.replace(/[\n\r\s]*$/,"");
    var endStart = msgText.indexOf("\n"+indent+"-----END PGP") + 1;
    var nextLine = msgText.substring(endStart).search(/[\n\r]/);
    if (nextLine > 0) {
      tail = msgText.substring(endStart+nextLine).replace(/^[\n\r\s]*/,"");
    }

    var pgpBlock = msgText.substring(startOffset - indent.length,
                                     endStart + nextLine);
    if (nextLine == 0) {
      pgpBlock += msgText(endStart);
    }
    if (indent)
      pgpBlock = pgpBlock.replace(new RegExp("^"+indent+"?", "gm"), "");

    var charset = aMsgWindow ? aMsgWindow.mailCharacterSet : "";
    msgText = EnigmailCommon.convertFromUnicode(pgpBlock, charset);

    var decryptedText =
      enigmailSvc.decryptMessage(window, 0, msgText,
        signatureObj, exitCodeObj,
        statusFlagsObj, keyIdObj, userIdObj, sigDetailsObj,
        errorMsgObj, blockSeparationObj);

    var matches = pgpBlock.match(/\nCharset: *(.*) *\n/i);
    if (matches && (matches.length > 1)) {
      // Override character set
      charset = matches[1];
    }

    var msgRfc822Text = "";
    if (head || tail) {
      if (head) {
        // print a warning if the signed or encrypted part doesn't start
        // quite early in the message
        matches = head.match(/(\n)/g);
        if (matches && matches.length > 10) {
          msgRfc822Text = EnigmailCommon.getString("notePartEncrypted")+"\n\n";
        }
        msgRfc822Text += head+"\n\n";
      }
      msgRfc822Text += EnigmailCommon.getString("beginPgpPart")+"\n\n";
    }
    msgRfc822Text += EnigmailCommon.convertToUnicode(decryptedText, charset);
    if (head || tail) {
      msgRfc822Text += "\n\n"+ EnigmailCommon.getString("endPgpPart")+"\n\n"+tail;
    }

    if (exitCodeObj.value == 0) {
      if (msgRfc822Text.length > 0) {
        bodyElement.querySelector("div.moz-text-plain").innerHTML =
          EnigmailFuncs.formatPlaintextMsg(msgRfc822Text);
        aMessage.decryptedText = msgRfc822Text;
      }
      return statusFlagsObj.value;
    }
    else {
      Log.error("Enigmail error: "+exitCodeObj.value+" --- "+errorMsgObj.value+"\n");
    }
  } catch (ex) {
    dumpCallStack(ex);
    Log.error("Enigmail error: "+ex+" --- "+errorMsgObj.value+"\n");
    return null;
  }
}


let enigmailHook = {
  _domNode: null,

  onMessageBeforeStreaming: function _enigmailHook_onBeforeStreaming(aMessage) {
    if (enigmailSvc) {
      let { _attachments: attachments, _msgHdr: msgHdr, _domNode: domNode } = aMessage;
      this._domNode = domNode;
      let w = topMail3Pane(aMessage);
      let hasEnc = (aMessage.contentType+"").search(/^multipart\/encrypted(;|$)/i) == 0;
      if (hasEnc && !enigmailSvc.mimeInitialized()) {
        Log.debug("Initializing EnigMime");
        w.document.getElementById("messagepane").setAttribute("src", "enigmail:dummy");
      }

      let hasSig = (aMessage.contentType+"").search(/^multipart\/signed(;|$)/i) == 0;
      if (hasSig)
        aMessage._domNode.classList.add("signed");
    }
  },

  onMessageStreamed: function _enigmailHook_onMessageStreamed(aMsgHdr, aDomNode, aMsgWindow, aMessage) {
    let iframe = aDomNode.getElementsByTagName("iframe")[0];
    let iframeDoc = iframe.contentDocument;
    if (iframeDoc.body.textContent.length > 0 && hasEnigmail) {
      let status = tryEnigmail(iframeDoc.body, aMsgWindow, aMessage);
      if (status & Ci.nsIEnigmail.DECRYPTION_OKAY)
        aDomNode.classList.add("decrypted");
      if (status & Ci.nsIEnigmail.GOOD_SIGNATURE)
        aDomNode.classList.add("signed");
      if (status & Ci.nsIEnigmail.UNVERIFIED_SIGNATURE) {
        aDomNode.classList.add("signed");
        aDomNode.getElementsByClassName("tag-signed")[0]
          .setAttribute("title", strings.get("unknownGood"));
      }
    }
  },

  onMessageBeforeSend: function _enigmailHook_onMessageBeforeSend(aAddress, aEditor, aStatus) {
    if (!hasEnigmail)
      return aStatus;

    const nsIEnigmail = Ci.nsIEnigmail;
    const SIGN    = nsIEnigmail.SEND_SIGNED;
    const ENCRYPT = nsIEnigmail.SEND_ENCRYPTED;

    let uiFlags = nsIEnigmail.UI_INTERACTIVE;

    let identity = aAddress.identity
    Enigmail.msg.identity = identity;
    Enigmail.msg.enableRules = true;
    Enigmail.msg.sendModeDirty = 0;

    let fromAddr = identity.email;
    let userIdValue;
    // Enigmail <= 1.3.2 doesn't support getSenderUserId.
    if (Enigmail.msg.getSenderUserId) {
      userIdValue = Enigmail.msg.getSenderUserId.call(Enigmail.msg);
    } else if (identity.getIntAttribute("pgpKeyMode") > 0) {
      userIdValue = identity.getCharAttribute("pgpkeyId");
    }
    if (userIdValue)
      fromAddr = userIdValue;

    Enigmail.msg.setSendDefaultOptions.call(Enigmail.msg);
    let sendFlags = Enigmail.msg.sendMode;
    if (Enigmail.msg.sendPgpMime) {
      // Use PGP/MIME
      sendFlags |= nsIEnigmail.SEND_PGP_MIME;
    }

    let optSendFlags = 0;
    if (EnigmailCommon.getPref("alwaysTrustSend")) {
      optSendFlags |= nsIEnigmail.SEND_ALWAYS_TRUST;
    }
    if (EnigmailCommon.getPref("encryptToSelf") || (sendFlags & nsIEnigmail.SAVE_MESSAGE)) {
      optSendFlags |= nsIEnigmail.SEND_ENCRYPT_TO_SELF;
    }
    let gotSendFlags = sendFlags;
    sendFlags |= optSendFlags;

    let toAddrList = aAddress.to.concat(aAddress.cc)
      .map(EnigmailFuncs.stripEmail);
    let bccAddrList = aAddress.bcc.map(EnigmailFuncs.stripEmail);

    let toAddr = toAddrList.join(", ");
    let bccAddr = bccAddrList.join(", ");
    // Enigmail <= 1.3.2 doesn't support keySelection.
    if (Enigmail.msg.keySelection) {
      let result = Enigmail.msg.keySelection.call(Enigmail.msg,
                     enigmailSvc, sendFlags, optSendFlags, gotSendFlags,
                     fromAddr, toAddrList, bccAddrList);
      if (!result) {
        aStatus.canceled = true;
        return aStatus;
      }
      else {
        sendFlags = result.sendFlags;
        toAddr = result.toAddr;
        bccAddr = result.bccAddr;
      }
    }

    let statusFlagsObj = {};
    let exitCodeObj = {};
    let errorMsgObj = {};

    try {
      let origText;
      let usingPGPMime = (sendFlags & nsIEnigmail.SEND_PGP_MIME) &&
                         (sendFlags & (ENCRYPT | SIGN));
      if (usingPGPMime) {
        uiFlags |= nsIEnigmail.UI_PGP_MIME;

        let newSecurityInfo = Cc[Enigmail.msg.compFieldsEnig_CID]
          .createInstance(Ci.nsIEnigMsgCompFields);
        newSecurityInfo.sendFlags = sendFlags;
        newSecurityInfo.UIFlags = uiFlags;
        newSecurityInfo.senderEmailAddr = fromAddr;
        newSecurityInfo.recipients = toAddr;
        newSecurityInfo.bccRecipients = bccAddr;
        newSecurityInfo.hashAlgorithm =
          Enigmail.msg.mimeHashAlgo[EnigmailCommon.getPref("mimeHashAlgorithm")];

        aStatus.securityInfo = newSecurityInfo;
      }
      else if (sendFlags & (ENCRYPT | SIGN)) {
        // inline-PGP
        let plainText = aEditor.value;
        let charset = "UTF-8";
        origText = plainText;
        if (!(sendFlags & ENCRYPT)) {
          plainText = simpleWrap(plainText);
        }
        plainText= EnigmailCommon.convertFromUnicode(plainText, charset);
        let cipherText = enigmailSvc.encryptMessage(window, uiFlags, null,
                           plainText, fromAddr, toAddr, bccAddr,
                           sendFlags, exitCodeObj, statusFlagsObj, errorMsgObj);

        let exitCode = exitCodeObj.value;
        if (cipherText && (exitCode == 0)) {
          if ((sendFlags & ENCRYPT) && charset &&
            (charset.search(/^us-ascii$/i) != 0) ) {
            // Add Charset armor header for encrypted blocks
            cipherText = cipherText.replace(/(-----BEGIN PGP MESSAGE----- *)(\r?\n)/,
              "$1$2Charset: "+charset+"$2");
          }
          cipherText = EnigmailCommon.convertToUnicode(cipherText, charset);
          aEditor.value = cipherText;
        }
      }

      if ((!(sendFlags & nsIEnigmail.SAVE_MESSAGE)) &&
           EnigmailCommon.getPref("confirmBeforeSend")) {
        if (!Enigmail.msg.confirmBeforeSend(toAddrList.join(", "), toAddr+", "+bccAddr,
             sendFlags, false)) {
          if (origText) {
            aEditor.value = origText;
          }
          aStatus.canceled = true;
          return aStatus;
        }
      }
    } catch (ex) {
      dumpCallStack(ex);
      Log.error("Enigmail encrypt error: "+ex+" --- "+errorMsgObj.value+"\n");
      let msg = EnigmailCommon.getString("signFailed");
      if (EnigmailCommon.enigmailSvc && EnigmailCommon.enigmailSvc.initializationError) {
        msg += "\n"+EnigmailCommon.enigmailSvc.initializationError;
      }
      aStatus.canceled =
        !EnigmailCommon.confirmDlg(window, msg, EnigmailCommon.getString("msgCompose.button.sendUnencrypted"));
    }
    return aStatus;
  },

  onReplyComposed: function _enigmailHook_onReplyComposed(aMessage, aBody) {
    if (hasEnigmail && aMessage.decryptedText) {
      return citeString("\n" + aMessage.decryptedText);
    }
    return aBody;
  },
}

registerHook(enigmailHook);
