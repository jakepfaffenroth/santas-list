/**
 * @copyright Copyright 2020 WompMobile, Inc.
 * This file contains works from many authors under various licenses.
 * Please visit http://www.wompmobile.com/license for more information.
 */

/*c
  Pwa features:
    Load multiple documents at once
    Base size - 10KB gzipped

  Development features:
    smaller classes
    modern JS features like async/await, fetch
    optimized for editing in vscode
    optional use of $ syntax
    Nice error handling.
    event-subscription model
      pwaDomAdded event fires when amp-lists add dynamic content

  Environment Notes:
    Closure compiler will be used to transpile to es5. Have fun with es6 features.
    Modern Browser APIs are polyfilled in appshell with companion appshell script id="wmPolyfill".
    Pwa script can be initialized/overwritten with optional pwaSessionInit JSON-LD object.
      This allows for remote customization via CDNs, appshell scripts and other such foolery.

  Class Structure - See class definitions for detailed method summaries:

  Amp Exends AmpCore - Custom AMP loading functions for site
  AmpCore - Generic AMP validating and loading functions
  Analytics - send GA events from PWA (opt)
  Appshell - Appshell related functions (opt)
  Mo - Custom Mobile Optimize loading functions for site (opt)
  Pwa - Overall Multi-Document Loader - start with Pwa.load
  Prefetch - prefetching functions necessary for Multi-Doc prefetching.
  PwaServiceWorker - service worker related functions (opt)
  Site - Site-specific functions like Cart Form submssion and sessioin management
  Util - Generic utilities

  Getting Started:

    1. This pwa script assumes 'Promise' and 'fetch' have been polyfilled in the appshell
        see <script id="wmPolyfill"> in appshell

    2. Once required Browser APIs are polyfilled, this pwa script is started via a call to pwaStart

    3. Configuration
      Pwa.session object is the single source of configuration data for the site.
        Pwa.constructor() is where the initial session object literal is defined
        Pwa.sessionInit() is where to manipulate Pwa.session after it has been defined.

      Pwa.loadDocGet() - This Pwa can load multiple docs at once.
          This function determines which host to load a document in.

    4. Key Page Interaction functions
      Amp.ampBeforeRender() - Modify the amp document before it is attached to the DOM.
      Amp.ampPostRender() - Modify the amp document after it is attached to the DOM.
      Pwa.clickBodyHandler() - Handles click events fired on the AMP shadowBody.

      Note: Pwa class is mostly about top-level routing.

    5. Error Handling & debugging
      Most error logging is toggled behind the Pwa.session.isStaging flag

  Other Notes:

    1. Code style: https://github.com/prettier/prettier
      To match AMP project. vs-code plugin is awesome.

    2. Sort methods within classes alphabetically please.

    3. Naming guideline:  TargetAction
      3a. Start with the name of the thing you are modifying (noun).
      3b. Append the modifying verb

      examples:
        group history-related functions together:
          historyPopStateHandler
          historyPush

        group amp loading related functions together:
          ampBeforeRender
          ampLoad
          ampPostRender

    4. This project can optionally use Cash.js for $ syntax
      https://github.com/kenwheeler/cash - 5.7 KB GZIP/compressed

      "Cash is an absurdly small jQuery alternative for modern browsers (IE11+) that provides jQuery-style syntax for manipulating the DOM.
      Developers can use the familiar chainable methods at a fraction of the file size."

      If you want to use cash, include the script in the appshell and verify $.fn
      exists on window.load before calling pwaStart.

  accessing amp state from outside PWA
    wmPwa.session.docObjActive.shadowDoc.getState('storeInfo').then(store => console.log(store))

  accessing amp state from inside PWA
    this.pwa.session.docObjActive.shadowDoc.getState('storeInfo').then(store => console.log(store))
*/

/**
 * Generic AMP-related functions for validating and loading AMP pages.
 * Most AMP-related development should happen class AMP, which extends this.
 */
class AmpCore {
  /**
   * Generic AMP loading elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    // This class is meant for generic amp functions.
    // Best practice is to call only functional methods on this.pwa in these methods:
    //    i.e. methods that don't depend/set this.pwa.session or other state.
    //    ex: this.pwa.errorCustom, this.pwa.util.parseDoc
    this.pwa = pwa;
  }

  /**
   * Attaches the newAmpDoc document fragment to the ampDocObj.hostElem shadowDOM.
   *
   * @param {Object} ampDocObj - object containing document and appshell host references
   * @param {Document} newAmpDoc - new AMP Document (parsed, not attached to DOM yet)
   * @param {String} href - href of newAmpDoc document
   * - Sets shadowDoc properties on provided ampDocObj.
   */
  ampAttachDoc(ampDocObj, newAmpDoc, href) {
    /* let the other amp documents know they can take a break */
    // for (const docObj of Object.values(this.pwa.session.docs)) {
    //   if (docObj.shadowDoc) docObj.shadowDoc.setVisibilityState("inactive");
    // }
    ampDocObj.shadowDoc = window.AMP.attachShadowDoc(
      ampDocObj.hostElem,
      newAmpDoc,
      href
    );
    ampDocObj.shadowBody = ampDocObj.shadowDoc.ampdoc.getBody();

    /* This parameter supports the amp framework multidocmanager:
          see https://github.com/ampproject/amphtml/blob/master/examples/pwa-multidoc-loader.html */
    ampDocObj.shadowBody.setAttribute("data-docnum", ampDocObj.docnum);
    ampDocObj.href = href;

    // ampDocObj.shadowDoc.setVisibilityState("visible");
  }

  /**
   * Clears the current ampDocObj.shadowDoc from ampDocObj.hostElem
   * This clears up resources and makes a clean slate for the next amp document
   *
   * @param {Object} ampDocObj - object containing document and host references
   * - clears amp document properties on ampDocObj
   * @returns {Promise} - promise that resolves when amp document is cleared
   */
  async ampClearDoc(ampDocObj) {
    const hostAttrWhitelist = /^(id|class|data)/i;
    // 1. Close shadow AMP
    try {
      await (ampDocObj.shadowDoc
        ? ampDocObj.shadowDoc.close()
        : Promise.resolve());
    } catch (ex) {
      console.log(ex);
    }

    // 2. Restore host element
    const oldHostElement = ampDocObj.hostElem;

    const newHostElement = document.createElement("div");
    for (let i = 0; i < oldHostElement.attributes.length; i++) {
      var a = oldHostElement.attributes[i];
      if (hostAttrWhitelist.test(a.name))
        newHostElement.setAttribute(a.name, a.value);
    }
    oldHostElement.parentNode.replaceChild(newHostElement, oldHostElement);

    Object.assign(ampDocObj, {
      hostElem: newHostElement,
      href: null,
      shadowBody: null,
      shadowDoc: null,
    });

    newHostElement.parentElement.scroll(0, 0);
  }

  /**
   * Dispatches a 'pwaDomAdded' event whenever an amp-list updates its dom with new content.
   * This function is intended to be run before the amp document is inserted into the DOM.
   *
   * These events can be consumed in the appshell document as shown in this example:
   *
      // Example - listening for the pwaDomAdded event.
      document.addEventListener('pwaDomAdded', function (e) {

          // This is the amp-list element (AJAX content wrapper)
          let parentAmpList = e.detail.ampList;

          console.log('pwaDomAdded event handled', parentAmpList, updatedContent);
      });
    *
    * @param {HTMLElement} parent - HTMLBody || amp-list
    *   - body of the amp document before it is appended to the body.
    *   - amp-list content that has just been replaced.
    *
    * - pwaDomAdded event emitted whenever the amp-framework updates the DOM.
    */
  ampEventsNewDomEmitterRegistration(parent) {
    const pwa = this;

    /**
     * When div.i-amphtml-replaced-content childList changes,
     * emit the "pwaDomAdded" event.
     *
     * @param {HTMLElement} ReplacedDiv - div where amp-list
     *     will add content (probably in pre-rendered state)
     * - emits the "pwaDomAdded" event
     */
    const ampListNewDomEmitter = function (mutationsList) {
      let addedNodes = false,
        ampList = null;

      for (const mutation of mutationsList) {
        const newAmpListContent = mutation.addedNodes[0];

        if (newAmpListContent) {
          addedNodes = true;
          ampList = newAmpListContent.parentElement.closest("amp-list");
          break;
        }
      }

      if (addedNodes) {
        /* If a callback from this emitter (or other code) modifies direct children of amp-list,
        This emitter will be triggered again. If this happens more than 3 times in under 100ms
        (assuming no one can type that fast), exit to prevent a feedback loop. */
        let amplistUpdateQty = parseInt(
          ampList.getAttribute("data-updates") || 0
        );
        if (amplistUpdateQty > 2) {
          return console.log(
            `#${ampList.id}: amp-list modified more than 2 times. not emitting new DOM event.`
          );
        } else {
          ampList.setAttribute("data-updates", amplistUpdateQty + 1);
        }

        // Register pwaDomAdded events on amp-lists inside of amp-lists.
        pwa.ampEventsNewDomEmitterRegistration(ampList);

        var event = new CustomEvent("pwaDomAdded", {
          detail: {
            ampList: ampList,
            target: mutationsList,
          },
        });
        document.dispatchEvent(event);

        /* clear state that is preventing possible feedback loops */
        setTimeout(
          function (ampList) {
            ampList.removeAttribute("data-updates");
          }.bind(null, ampList),
          100
        );
      }
    };

    /* amp-lists may be in a "cold" or "warm" state,
    depending on if the amp framework has initialized them. */

    /**
     * Once div.i-amphtml-replaced-content is attached to DOM,
     * place mutation observer on it (callback - ampListReplacedEventEmitter)
     * @param {MutationRecord} mutationsList - direct child elements of amp-list that have changed.
     */
    const ampListWaitForInitialization = function (mutationsList) {
      let replacedMutation = Array.from(mutationsList).filter((mutation) => {
        const elem = mutation.addedNodes[0];
        let isReplacedDiv = true;

        if (!elem) return false;

        // ignore amp-list children that are not replaced content.
        if (
          elem.matches(".i-amphtml-loading-container") ||
          elem.tagName !== "DIV" ||
          elem.hasAttribute("placeholder") ||
          elem.hasAttribute("fallback") ||
          elem.hasAttribute("overflow")
        )
          isReplacedDiv = false;
        else if (elem.matches(".i-amphtml-replaced-")) isReplacedDiv = true;

        // If it is not the divs above,
        // assume it is the content div
        return isReplacedDiv;
      })[0];

      if (replacedMutation) {
        /* ReplacedDiv element has been attached to the amp-list!
          However, the AMP framework may change this div's
          classnames and attributes as time goes on, so we can't
          use the tests above to reliably find it.

          Instead, attach another Mutation observer on the
          ReplacedDiv that will (efficiently) watch
          for changes on ReplacedDiv's direct children. */
        const replacedDiv = replacedMutation.addedNodes[0];
        const observer = new MutationObserver(ampListNewDomEmitter);
        observer.observe(replacedDiv, { childList: true });
        this.disconnect();
      }
    };

    // cold start - Place Intersection observer on uninitialiazed amp-lists
    // (amp-lists waiting for children divs to be initialized by amp framework)
    const monitoredCold = Array.from(parent.querySelectorAll("amp-list"));
    for (const ampList of monitoredCold) {
      const observer = new MutationObserver(ampListWaitForInitialization);
      observer.observe(ampList, { childList: true });
    }

    // warm Navigation - Place Intersection observer on intitialized amp-list children
    let monitoredWarm = [];
    for (const child of parent.children) {
      monitoredWarm = monitoredWarm.concat(
        Array.from(
          child.querySelectorAll(
            "amp-list>div:not([placeholder]):not([fallback]):not([overflow])"
          )
        )
      );
    }
    for (const ampListContent of monitoredWarm) {
      const observer = new MutationObserver(ampListNewDomEmitter);
      observer.observe(ampListContent, { childList: true });
    }
  }

  // JW - handled in Appshell now
  // /**
  //  * Waits for the AMP framework to load
  //  *
  //  * @returns {Promise} - promise that resolves when the shadow-v0.js amp framework is ready
  //  */
  // ampFrameworkReady() {
  //   return new Promise((resolve) => {
  //     (window.AMP = window.AMP || []).push(resolve);
  //   });
  // }

  /**
   * Returns state property from active amp document
   * @param {String} stateId - the name of the state needed
   * @param {int} maxWait - maximum number of ms to wait for state to become available
   * @returns {Promise} resolves to state object once state object is available.
   */
  async ampGetState(stateId, maxWait = 10000) {
    return new Promise(async (resolve, reject) => {
      let docObjActive, activeDoc;
      try {
        docObjActive = await this.pwa.util.waitForProp(
          "docObjActive",
          this.pwa.session
        );
        activeDoc = await this.pwa.util.waitForProp("shadowDoc", docObjActive);
      } catch (ex) {
        debugger;
      }
      if (!activeDoc) reject("active doc not found");

      let state = await activeDoc.getState(stateId);
      if (state) {
        // console.log("found state:", stateId, state);
        resolve(state);
      } else {
        /* Maximum amount of time to wait */
        const timeout = setTimeout(() => {
          clearInterval(waitInterval);
          resolve({ errMsg: `Unable to get data for AMP.${stateId}` });
        }, maxWait);

        /* check for state every 200ms */
        const waitInterval = setInterval(async () => {
          let state = await activeDoc.getState(stateId);
          // console.log("waiting for state:", stateId, state);
          if (state) {
            // console.log("found state:", stateId, state);
            clearInterval(waitInterval);
            clearTimeout(timeout);
            resolve(state);
          }
        }, 200);
      }
    });
  }

  /**
   * Update amp-state on amp document fragment before
   * the document is attached to the host DOM
   *
   * @param {CashJsCollection} ampDoc$ - Amp document fragment
   * @param {String} id - Id of amp-state element to update
   * @returns {Object} - Sets amp-state in ampDoc or returns empty object
   */
  ampGetStateBeforeRender(ampDoc$, id) {
    const ampStateScript = ampDoc$.find(`#${id}`).find("script");
    if (ampStateScript.length) {
      try {
        let ampStateObj = JSON.parse(ampStateScript.text());
        return ampStateObj;
      } catch (ex) {
        this.pwa.errorCustom(ex);
      }
    }
    return {};
  }

  /**
   * Update amp-state on amp document fragment before
   * the document is attached to the host DOM
   * JW TODO - refactor to use blocking Native DOM methods
   *
   * @param {CashJsCollection} ampDoc$ - Amp document fragment
   * @param {String} id - Id of amp-state element to update
   * @param {Object} obj - object to merge with amp-state.
   * @returns {undefined|Error} - Sets amp-state in ampDoc or returns error
   */
  ampSetStateBeforeRender(ampDoc$, id, obj) {
    const ampStateScript = ampDoc$.find(`#${id}`).find("script");
    if (ampStateScript.length) {
      try {
        let ampStateObj = JSON.parse(ampStateScript.text());
        ampStateObj = ampStateObj
          ? this.pwa.util.mergeRecursive(ampStateObj, obj)
          : obj;
        ampStateScript.text(JSON.stringify(ampStateObj));
        return ampStateObj;
      } catch (ex) {
        return this.pwa.errorCustom(ex);
      }
    } else {
      ampDoc$.find("body")[0].insertAdjacentHTML(
        "beforeend",
        `
        <amp-state id="${id}">
          <script type="application/json">
            ${JSON.stringify(obj)}
          </script>
        </amp-state>
        `
      );
    }
  }

  /**
   * Update amp-state on one or more amp
   * documents after the document has been attached to the host.
   *
   * IMPORTANT - only call this in response to a user interaction. (click or hover)
   * Most amp pages are built with the assumption that amp-bind will not be triggered programatically.
   * Breaking this assumption can have unexpected side effects if amp-list assets are not fully downloaded.
   *
   * @param {Object} stateObj - object to update amp-state(s) with
   * @param {Object} docObjs (opt) - Object containing target docObj(s) for amp-state update.
   *    defaulst to docObjActive
   * @returns {Promise} - set state promises
   */
  async ampsSetState(stateObj, docObjs) {
    docObjs = docObjs || { activeDoc: this.pwa.session.docObjActive };
    // if (this.pwa.session.isPreprod)
    console.log("setting state", stateObj, docObjs);
    console.log(stateObj);
    if (this.pwa.session.ampStateUnstable) {
      const setStateCallBack = function (stateObj, docObjs) {
        document.removeEventListener("ampStateIsStable", setStateCallBack);
        // if (this.pwa.session.isDebug) console.trace("setting state", stateObj);
        this.ampsSetState(stateObj, docObjs);
      }.bind(this, stateObj, docObjs);
      document.addEventListener("ampStateIsStable", setStateCallBack);
      return;
    }

    // set state on all provided amp documents
    const setStatePromises = [];
    for (const docObj of Object.values(docObjs)) {
      if (!docObj || !docObj.shadowDoc) continue;
      setStatePromises.push(docObj.shadowDoc.setState(stateObj));
    }
    return Promise.all(setStatePromises).catch((e) => console.log(e));
  }

  /**
   * Triggers "ampStateIsStable" event
   * if this.pwa.session.ampStateUnstable flag is true,
   * ampsSetState defers setting state until this function is called.
   * Used to prevent premature AMPsetState calls while PDP page is loading.
   */
  async ampsAmpStateIsStableEvt() {
    // debounce - only trigger ampStateIsStable event once
    if (!this.pwa.session.ampStateUnstable) return;

    this.pwa.session.ampStateUnstable = false;
    var event = new CustomEvent("ampStateIsStable");
    document.dispatchEvent(event);
  }

  /**
   * Ensures that the AMP fetch response code and mimetype are valid
   * Some sites commonly link to PDFs and other non-HTML documents.
   * This prevents trying to load those in an amp ShadowDOM.
   *
   * @param {Response} res - AMP document response from fetch request
   * @param {URL} urlObj - URL object for pending page load url
   * @returns {String|Promise} - AMP document text | Promise(rejected)
   */
  async ampValidateResponse(res, urlObj) {
    const htmlMimeTypeReg = /text\/html/i;
    if (!htmlMimeTypeReg.test(res.headers.get("content-type")))
      throw this.pwa.errorCustom("response is not html", res);

    if (res.status == 200) return await res.text();

    if (res.status == 202) {
      throw this.pwa.errorCustom("ampPageNotBuilt", {
        res: res,
        urlObj: urlObj,
      });
    }

    throw this.pwa.errorCustom("fetchError", res);
  }

  /**
   * Parses and validates the AMP fetch response text
   *
   * @param {String} domText - AMP document text
   * @returns {Document|Promise}
   *    - AMP Document (parsed, not attached to DOM yet) | Promise(rejected)
   *
   * JW TODO - If this is a valid HTML doc, but not AMP, maybe just pass it to Mo.moLoad?
   */
  ampValidateResponseDoc(domText, urlObj) {
    /* 6.15.21 JW temp CBCC domain cutover compatibility */
    if (this.pwa.session.isBABY) {
      let isCbccBaby = !/(bbbabyapp|buybuybaby)\.com/i.test(location.hostname);
      let hostName = location.hostname,
        replacedHostReg;
      if (isCbccBaby) {
        replacedHostReg =
          /(dev01|et01|em02|et02|e-www3preview)-www.bbbabyapp.com|www.buybuybaby.com/gi;
      } else {
        replacedHostReg =
          /(dev01|et01|em02|et02|e-www3preview)baby-www.bbbyapp.com|buybuybaby.bedbathandbeyond.com/gi;
      }
      domText = domText.replace(replacedHostReg, hostName);
    }

    if (this.pwa.session.isHARMON) {
      let isCbccHarmon = !/(harmonfacevalues)\.com/i.test(location.hostname);
      let hostName = location.hostname,
        replacedHostReg;
      if (isCbccHarmon) {
        replacedHostReg =
          /(dev01|et01|em02harmon|et02|e-www3preview)-www.bbbyapp.com|www.harmonfacevalues.com/gi;
      } else {
        replacedHostReg =
          /(dev01|et01|em02harmon|et02|e-www3preview)-www.bbbyapp.com|harmonfacevalues.bedbathandbeyond.com/gi;
      }
      domText = domText.replace(replacedHostReg, hostName);
    }

    let ampDoc = this.pwa.util.parseDoc(domText);
    /*
      Check if Womp system has sent a 200 Response, but the document is a redirect document
      example:
        https://stagingonlinemetalsamp.ampify.wompmobile.com/buy/aluminum-foil-1000-series-o
        <!doctype html>
        <html amp>
        <head>
          <meta http-equiv="Refresh" content="2; url=https://www-staging.onlinemetals.com/en/buy/aluminum-foil-1000-series-o" />
        </head>
        <body>
          <p>Please click <a href="https://www-staging.onlinemetals.com/en/buy/aluminum-foil-1000-series-o">here</a> if you
            are not automatically redirected.</p>
        </body>
        </html>
      */

    let metaRefresh = ampDoc.querySelector('meta[http-equiv="Refresh"]');
    if (metaRefresh) {
      //  Some pages need to redirect to a search page instead of not-found
      const { isSearchReg, isCLPReg, isPLPReg } = this.pwa.session.docTests;
      let isRedirectToSearch = urlObj
        ? /\/category\/[a-z]+\/[0-9]+$/i.test(urlObj.pathname)
        : false;
      let isRedirectToCLP = urlObj
        ? isPLPReg.test(urlObj.pathname) && !isCLPReg.test(urlObj.pathname)
        : false;
      let url = metaRefresh.getAttribute("content");
      url = url.replace(/.*url=/, "");
      let redirectObj = new URL(url, location.origin); //adding location.origin optional param to allow for relative meta redirects, this is required for siteSpect.

      // Redirect to search page using intended page as search term
      // 10.29.21 exclude CA kitchen because it breaks frequently and results in redirect loop
      if (
        isRedirectToSearch &&
        /not-found/i.test(redirectObj.pathname) &&
        urlObj.pathname !== "/store/category/kitchen/20002"
      ) {
        const regexMatch = urlObj.pathname.match(/\/([a-z]+)\/[0-9]+$/i);

        if (regexMatch.length > 1) {
          redirectObj.pathname = regexMatch[1];

          if (isRedirectToSearch) {
            url = location.origin + "/store/s/" + encodeURI(regexMatch[1]);
          } else if (isRedirectToCLP) {
            url = location.origin + "/store/s/" + encodeURI(regexMatch[1]);
          }
          this.pwa.session.redirectInProgress = true;
          throw this.pwa.errorCustom("wompRedirect", url);
        } else {
          throw this.pwa.errorCustom("not found redirect");
        }
      } else if (/not-found/i.test(redirectObj.pathname)) {
        throw this.pwa.errorCustom("not found redirect");
      } else {
        // strip out /amp/, this is needed for siteSpect,
        // and should not negatively impact other meta redirets
        redirectObj.pathname = redirectObj.pathname.replace(/^\/amp/, "");
        url = redirectObj.href;
        this.pwa.session.redirectInProgress = true;

        throw this.pwa.errorCustom("wompRedirect", url);
      }
    }

    /* Ensure that the amp page is valid */
    let ampHtml = ampDoc.getElementsByTagName("HTML")[0];
    if (!ampHtml.hasAttribute("amp") && !ampHtml.hasAttribute("⚡")) {
      throw this.pwa.errorCustom("ampPageNotValid", domText);
    }

    return ampDoc;
  }
}

/**
 * Custom AMP functions
 * Most PWA AMP-related development should happen in this class.
 * If your function is specific to the site, this is a good place to put it.
 */
class Amp extends AmpCore {
  /**
   * AMP page specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    super(pwa);

    this.pwa = pwa;

    /* Handle amp-list pwaDomAdded events.
      A good use case for this is registering event listeners
      on amp-list elements (like forms)
    */
    document.addEventListener("pwaDomAdded", (pwaDomAddedEvt) => {
      this.ampListPostRender(pwaDomAddedEvt.detail.ampList);
    });
  }

  /**
   * Modify the AMP document before it is attached to the ShadowDOM.
   * Document changes made in this function won't trigger
   * repaints or amp javascript evaluation,
   * so they are much faster.
   *
   * @param {HTMLDocument} ampDocFrag
   *    - AMP document fragment before it is attached to the ShadowDOM
   * @param {URL} urlObj - url to fetch
   * @param {String} searchPathname (opt) - pathname.search if this is a search page
   *    ex: ?text=blue+steel
   * @param {String} pdpSkuId (opt) - skuId if product is a skuId url
   * @returns {Promise} - Resolves when ampBeforeRender logic is finished.
   *    Async logic is best located in ampPostRender
   */
  async ampBeforeRender(
    ampDocFrag,
    urlObj,
    searchPathname = undefined,
    pdpSkuId = undefined
  ) {
    const ampDoc$ = $(ampDocFrag);
    const ampBody$ = ampDoc$.find("body");
    let ampDocVersion = parseInt(ampBody$.attr("data-version") || 0);
    if (isNaN(ampDocVersion)) ampDocVersion = 0;
    console.log(`AMP Doc Version: ${ampDocVersion}`);

    // -3. Search page - Modify state to match search query in urlObj
    // override default searchTemplate amp page state and values with "search"
    await this.ampBeforeRenderReplaceSearchTerm(ampDoc$, searchPathname);

    // -2. Render header tags for SEO into appshell
    this.pwa.appshell.addHeaderTagsToAppshell(ampBody$);

    // -1. User Data
    this.pwa.user.ampBeforeRenderUser(ampDoc$);

    // 0. feature switching -
    // Adding features to ampState
    this.pwa.amp.ampSetStateBeforeRender(
      ampDoc$,
      "features",
      this.pwa.session.features || {}
    );

    //0.1 Feature swtiching (hide/show)
    // this.pwa.session.features defined in
    //  extra-womplib.js > pwaSessionInit and
    // appshell/before-render.js > config API calls
    // ex: [data-feature="pdpSddFreeShippingMsg"]
    for (const [featureName, enabled] of Object.entries(
      this.pwa.session.features || {}
    )) {
      const feature = $(
        this.pwa.$$$(ampDoc$[0], `[data-feature="${featureName}"]`)
      );
      const featureHide = $(
        this.pwa.$$$(ampDoc$[0], `[data-feature-hide="${featureName}"]`)
      );
      if (enabled) {
        feature.removeClass("wHide");
        featureHide.addClass("wHide");
      } else {
        feature.addClass("wHide");
        featureHide.removeClass("wHide");
      }
    }

    //0.2 update registry
    if (this.pwa.session.features.registryEnable)
      this.pwa.registry.ampBeforeRender(ampDoc$, urlObj, ampBody$);

    // 1. update any persistent amp-states
    this.ampBeforeRenderStorageSync(ampDoc$);

    // 1a. import binding expressions from other amp-document if appropriate.
    this.ampBeforeRenderBindingSync(ampBody$);

    // 1b. update selected store state in header
    let changeStore = this.pwa.session.amp_sessionStorage.changeStore;
    let updateStoreApi = ampDoc$.find("#updateStoreApi").attr("expression");
    if (changeStore && updateStoreApi) {
      // deselect Same Day delivery on all pages except search pages
      // (search pages use changeStore.sddActiveSearch).
      changeStore.sddActive = false;
      this.ampSetStateBeforeRender(ampDoc$, "changeStore", changeStore);
      /*. 11.10.20 JW - begin transition to [data-store-info],  begining phase out (#storeInfo, #csBannerList, .csBanner amp-list) */
      this.ampBeforeRenderBindEval(
        ampDoc$,
        `#storeInfo,
        #csBannerList,
        .csBanner amp-list,
        [data-store-info],
        #plpControlBopis,
        #plpBopusList
        `,
        "src",
        {
          changeStore: changeStore,
        },
        updateStoreApi
      );
    }

    // Handle amp OOS form event
    /*
      For some reason when coming from amp, the urlObj does not have the search params needed,
      so have to use location.href. This is ok since we are only concerned about
      transition from native amp to PWA
    */
    if (/type=oosAmpForm/.test(location.href))
      this.pwa.site.pdpOosModalHandler(ampDoc$);

    //Remove MARKETPLACE_ITEM_FLAG from pdp templage
    if (
      this.pwa.session.docTests.isPDPReg.test(urlObj.pathname) &&
      !this.pwa.session.features.enableMarketplace
    ) {
      if (!this.pwa.session.features.enableMarketplace) {
        this.pwa.util.replaceStringInTemplate(
          ampBody$,
          /\{\{(\#|\^|\/)MARKETPLACE_ITEM_FLAG\}\}/gi,
          " ",
          "prodOfferTemplate"
        );
        this.pwa.util.replaceStringInTemplate(
          ampBody$,
          /\{\{(\#|\^|\/)MARKETPLACE_ITEM_FLAG\}\}/gi,
          " ",
          "prodFulfillTemplate"
        );
        this.pwa.util.replaceStringInTemplate(
          ampBody$,
          /\{\{(\#|\^|\/)MARKETPLACE_ITEM_FLAG\}\}/gi,
          " ",
          "prodFulfillTemplate2"
        );
      }
    }

    /*
      Backfill sticky CTA form to send sdd zip if it does not contain the intput
      Decided to modify the template instead of Amp list post render due to amp bind expressions
      This can be removed after a full rebuild of PDP. Probably 12/1/21
    */
    // if (
    //   ampDoc$.find(`#stickyCta`).length > 0 &&
    //   !/name="sddZip"/i.test(ampDoc$.find(`#stickyCta`)[0].innerHTML)
    // ) {
    //   const stickyTmp = ampDoc$.find(`#stickyCta`)[0].innerHTML;
    //   const newStickyTmp = stickyTmp.replace(
    //     /<input type="hidden" name="type" value="cart" \[value\]="!pdpCtaType \? 'cart' : pdpCtaType">/gi,
    //     `
    //     <input type="hidden" name="type" value="cart" [value]="!pdpCtaType ? 'cart' : pdpCtaType">
    //     <input type="hidden" name="sddZip" [value]="pdpCtaType == 'deliverIt' ? changeStore.sddZipcode : null">
    //   `
    //   );
    //   ampDoc$.find(`#stickyCta`).replaceWith(`
    //   <template id="stickyCta" type="amp-mustache">
    //     ${newStickyTmp}
    //   </template>
    //   `);
    // }

    // MCM - TEMP Added 10/14/2021 to hotfix PPS-4242.
    // directcall=true was also removed in extraWompLib, removing here too, to fix without rebuild
    // MCM - Added 10/21/2021, changed from 'location.pathname' to 'urlObj.pathname'.
    // When doing spa soft, 'location' is the old page, not the new page!
    // Also, added regex check to ensure we do not strip directCall from new API call
    if (this.pwa.session.docTests.isPDPReg.test(urlObj.pathname)) {
      let storeSkuSearch = ampBody$.find("#storeSkuSearch");
      // ensure this is old API call with directCall
      if (
        storeSkuSearch &&
        /search\/sku\?directCall/i.test(storeSkuSearch.attr("expression"))
      ) {
        storeSkuSearch.attr(
          "expression",
          storeSkuSearch.attr("expression").replace("directCall=true&", "")
        );
        console.log("Removed directCall=true param from search/sku API call");
      }
    }

    /*
      Backfill marketplace add to cart support. Somehow this was removed from the template
      This can be removed in mid January 2022
    */
    // if (this.pwa.session.docTests.isPDPReg.test(urlObj.pathname)) {
    //   try {
    //     let mktPlace = this.pwa.$$$(ampDoc$[0], `[name="marketPlaceItem"]`);
    //     if (mktPlace.length == 0) {
    //       // add the items to the tempalte
    //       $(this.pwa.$$$(ampDoc$[0], `.ctaRow .cartForm [name="prodId"]`)).each(
    //         function () {
    //           if ($(this).closest("amp-list").length == 0)
    //             $(this).after(
    //               `
    //               {{#offer_id}}
    //                 <input type="hidden" name="marketPlaceItem" value="true">
    //                 <input type="hidden" name="marketPlaceOfferId" value="{{offer_id}}">

    //                 <input type="hidden" name="marketPlaceItemOverSized"
    //                 value="{{#marketPlaceItemOverSized}}{{marketPlaceItemOverSized}}{{/marketPlaceItemOverSized}}
    //                 {{^marketPlaceItemOverSized}}false{{/marketPlaceItemOverSized}}">
    //               {{/offer_id}}
    //             `
    //             );
    //         }
    //       );
    //     }
    //   } catch (e) {
    //     console.warn(`Unable to check marketplace flag. Error: ${e}`);
    //   }
    // }

    // Add .navV1/.navV2 body class; Insert navV2 css; Remove unused nav component
    // Make sure the new nav actually exists before injecting a bunch of css that might confict on old pages
    // reset the payment options boolean so it can rerender on next pdp load
    if (
      this.pwa.session.paymentInit &&
      this.pwa.session.docTests.isPDPReg.test(urlObj.pathname)
    )
      delete this.pwa.session.paymentInit;

    // Add .navV1/.navV2 body class; Insert navV2 css; Remove unused nav component
    // Make sure the new nav actually exists before injecting a bunch of css that might confict on old pages

    // this.pwa.navPanel.navV2Shim(ampDoc$, ampBody$);

    // iOS use tag bug: inline svgs
    this.ampBeforeRender_iosInlineSvg(ampDocFrag.body);

    /* Remove PWA incompatible amp-elements:
       service worker iframe,
       amp-position-observer & amp-animation (back-to-top btn)
       AMP specific GroupBy Analyitcs (since in PWA they are handled by Tealium)
    */
    //  6.28.21 Keeping amp-animation. Used by mod_countdown_clock and no longer incompatible with PWA
    //  amp-animation,
    //  script[custom-element="amp-animation"],
    //  script[custom-element="amp-anim"],
    ampDoc$
      .find(
        `
        #clear.cbh,
        #swiframe,
        amp-install-serviceworker,
        script[custom-element="amp-install-serviceworker"],
        .componentWrapper-GoogleDFP+.componentWrapper-GoogleDFP,
        #groupByAMPAnalytics,
        link[rel="preload"][as="script"]
        `
      )
      .remove();

    if (this.pwa.session.isFast) {
      ampDoc$
        // remove amp-ads, service worker installation
        .find(
          `
          script[custom-element="amp-install-serviceworker"],
          amp-install-serviceworker,
          script[custom-element="amp-ad"]
          `
        )
        .remove();

      this.pwa.util
        .querySelectorAllDomAndTemplate(ampBody$[0], "amp-ad")
        .forEach((ad) => ad.remove());
    }

    // checking version of PDP template
    this.pwa.session.isPdpV2 =
      ampBody$.hasClass("pdpV2") || ampBody$.hasClass("pdpV21");

    this.pwa.session.isPdpV21 = ampBody$.hasClass("pdpV21");

    /*
      Apparently media queries do not work on position observers
      BBB initially requested that the sticky be included on mobile and pure amp
      So we built this with amp-position-observer, then UX asked us to remove on mobile and tablet
      Mockup https://app.zeplin.io/project/61296e6f149ffda2e8151cf5/dashboard?sid=616469f657da051074c13fad
      Went with this solution in case they flip back, but we could used a standard intersection observer now.
      Not sure of the benefits.
    */
    if (this.pwa.session.isPdpV21 && window.outerWidth > 1024)
      ampBody$.find("#second").prepend(
        `<amp-position-observer
          on="enter:hideHead.start; exit:showHead.start; scroll:hideHead.start"
          media="(min-width: 1024px)"
          layout="nodisplay"
          viewport-margins="0 90vh"
          intersection-ratios="0">
      </amp-position-observer>`
      );

    if (this.pwa.session.features.pdpCollectionsV2 && window.outerWidth > 1024)
      ampBody$.find("#mobileStickyObserver").remove();

    this.pwa.pdpDataAbstraction = this.pwa.session.isPdpV2
      ? new PdpDataAbstractionV2(this.pwa)
      : new PdpDataAbstractionV1(this.pwa);

    // PWA-specific styles
    this.ampBeforeRenderCss(ampDoc$, ampBody$, ampDocVersion);

    // SEO data
    ampDoc$.find('link[rel="alternate"]').each((i, e) => {
      let alt = $(e);
      alt.attr("href", alt.attr("href").replace("/amp", ""));
    });
    if (pdpSkuId) {
      /* SEO updates for PDPs with ?skuId param */
      [
        {
          selector: 'meta[property="og\\:url"]',
          property: "content",
        },
      ].forEach((element) => {
        ampDoc$.find(element.selector).attr(element.property, location.href);
      });
    }
    const metaLdJson = ampDoc$
      .find(
        `
        head title,
        meta:not([name="amp-script-src"]),
        ${
          // 1.7.21 - Structured data will live in body now - behind flag for now - JP
          this.pwa.session.features.bodyStructuredData
            ? ""
            : 'script[type="application/ld+json"],'
        }
        link[rel="preload"][as="fetch"],
        link[rel="preload"][as="image"],
        link[rel="canonical"],
        link[rel="alternate"],
        link[rel="amphtml"]
      `
      )
      .remove(); // Remove from ampDoc$ because we're appending them to the appshell <head> and we don't want duplicated on the page - especially for script[type="application/ld+json"] structured data
    this.pwa.appshell.elems.head
      .find(
        'title, link[rel="canonical"],link[rel="alternate"], meta[name=description]'
      )
      .remove();
    this.pwa.appshell.elems.head[0].insertAdjacentHTML(
      "beforeend",
      metaLdJson.outerHTML()
    );

    this.ampBeforeRenderSeo(ampDoc$);

    // JW todo - Update product list query to match url base64 parameters
    try {
      // checking parameters for write a review modal or ask a question
      const ctaParams = this.pwa.session.ctaParams;
      for (let i = 0; i < ctaParams.length; i += 1) {
        let item = ctaParams[i];
        const tmpReg = new RegExp(item, "gi");
        if (tmpReg.test(urlObj.search)) {
          this.pwa.site.scrapeProdData(ampDoc$, urlObj, item);
          break;
        }
      }
    } catch (e) {
      console.warn(
        `Unable to get CTA parameters from pwa session or error matching parameters to url. Error ${e}`
      );
    }

    // All desktop only functions (need to migrate)
    await this.pwa.desktop.ampBeforeRenderAll(ampDoc$);

    // Ensure that form[data-pwa-handler] are only handled by PWA, not AMP framework
    this.pwa.site.formPwaHandlerOnly(ampDoc$);

    // Remove mPulse script from amp doc as there is a different one for PWA inserted in everyPagePostRender
    ampDoc$.find('amp-analytics[type="mpulse"]').remove();

    // remove the Tealium analytics iFrame, and cache the data object on the body
    const ampAdobeAnalytics = ampDoc$[0].querySelector("#adobeAnalyticsConfig");
    if (ampAdobeAnalytics) {
      try {
        const adobeScript =
          ampAdobeAnalytics && ampAdobeAnalytics.querySelector("script");
        let json = JSON.parse(adobeScript.textContent);
        let iFrameURL = new URL(json.requests.iframeMessage);
        // set the ampPathSearch of the docObj that will be used. This is picked up in scriptsEveryPagePostRender
        if (this.pwa.session.docTests.isPDPReg.test(urlObj.pathname)) {
          this.pwa.session.docs.pdp.ampPathSearch = iFrameURL.hash.replace(
            "#",
            ""
          );
        } else {
          this.pwa.session.docs.primary.ampPathSearch = iFrameURL.hash.replace(
            "#",
            ""
          );
        }
        // remove the iFrame
        ampAdobeAnalytics.parentNode.removeChild(ampAdobeAnalytics);
      } catch (ex) {
        console.error("Unable to parse adobe analytics script\n", ex);
      }
    }

    if (this.pwa.session.runSiteSpect && !this.pwa.quickView.quickViewLoaded) {
      // Find the sitespect scripts, cache them on the session object, so we can run in the after render.
      this.pwa.session.siteSpectScripts = ampDoc$.find("[data-sitespect]");
    } else {
      ampDoc$.find("[data-sitespect]").remove();
    }

    /* recent searches in search input */
    if (!this.pwa.session.docTests.isSearchReg.test(urlObj.pathname)) {
      // Possible race condition with product script on PDP
      this.pwa.site.recentSearchDataUpdate(ampDoc$);
    } else {
      /*
        search page so update searchTerm state with recent search term
        CX-1231 requested only to show search term on search page
      */
      try {
        // may be a redirect from react or may be a first load or longtail
        let reg = /\/store\/s\/([^\/]+)/i;
        let sMatch = reg.exec(urlObj.pathname);
        let searchTerm =
          sMatch.length > 1
            ? decodeURIComponent(
                sMatch[1].replace(/-/gi, " ").replace(/_/gi, '"')
              )
            : this.pwa.session.lastSearchTerm;

        // let searchList = localStorage.getItem("recentsearchList");
        if (searchTerm !== "") {
          this.pwa.amp.ampSetStateBeforeRender(
            ampDoc$,
            "searchTerm",
            searchTerm
          );
          ampDoc$
            .find("#searchlabel")
            .addClass("active")
            .find("div")
            .eq(1)
            .text(searchTerm);

          // PPS-3603 PWA typeahead issues - prefill value and focus at end of input
          // binding the input to a state was causing race condition
          ampDoc$.find("input.searchInput").val(searchTerm);
        }
      } catch (e) {
        console.log(`Unable to update recent search term. Error: ${e}`);
      }
    }

    // Add recent searches to search template
    // this.pwa.site.recentSearchTemplateUpdate(ampDoc);

    // 6.21.21 Hotfix - PPS-2122 BOPIS Page Sequencing Inconsistent
    $(
      this.pwa.util.querySelectorAllDomAndTemplate(
        ampBody$[0],
        '[data-test^="shopStoreBtn"]'
      )
    ).attr("href", "/store/pickup/store-{{storeId}}");

    /*** Pencil banner scroll binding ***/
    this.pwa.pencilBanner.ampBeforeRender(ampBody$, urlObj);
    // this.pwa.appshell.insertPencilObserverEle(ampDoc$);

    this.pwa.findMyCollege.ampBeforeRender(ampBody$, urlObj);

    /*** PLP Mods ***/
    this.ampBeforeRenderPlp(
      ampDoc$,
      ampBody$,
      urlObj,
      changeStore,
      searchPathname
    );

    /*** PDP Mods ***/
    await this.pwa.pdp.ampBeforeRenderPdp(
      ampDoc$,
      urlObj,
      changeStore,
      pdpSkuId
    );

    await this.pwa.college.ampBeforeRenderCollege(ampDoc$, urlObj);

    // this shouldnt be added, is removed in after render but it is showing up in PWA so removing it here
    if (!this.pwa.session.features.sdd) {
      ampDoc$.find("#storeInfo").remove();
    }
  }

  /**
   * Workaround for SVG symbols in AMP shadow on iOS
   * https://github.com/ampproject/amphtml/issues/11914
   * https://bugs.webkit.org/show_bug.cgi?id=174977
   */
  ampBeforeRender_iosInlineSvg(ampBody) {
    if (!/ipod|iphone|ipad/i.test(navigator.userAgent)) return;

    this.pwa.util
      .querySelectorAllDomAndTemplate(ampBody, "svg>use")
      .forEach((use) => {
        try {
          var svg = use.parentNode;
          var svgId = use.getAttribute("xlink:href");
          if (!svgId) {
            console.log("SVG: <use> is missing xlink:href:\n", svg);
            return;
          }
          var symbol;
          try {
            // catch errors due to invalid svgIds
            symbol = ampBody.querySelector(svgId);
            if (!symbol) {
              console.log("SVG: missing xlink:href definition: " + svgId);
              return;
            }
          } catch (ex) {
            return;
          }
          var symbolClone = symbol.cloneNode(true);
          var svgViewbox = svg.getAttribute("viewBox");
          if (!svgViewbox) {
            var useViewbox = symbol.getAttribute("viewBox");
            if (useViewbox) svg.setAttribute("viewBox", useViewbox);
          }
          while (svg.firstChild) svg.removeChild(svg.firstChild);
          while (symbolClone.firstChild)
            svg.appendChild(symbolClone.firstChild);
        } catch (ex) {
          console.error("Unable to inline SVG", ex);
        }
      });
  }

  /**
   *
   * @param {CashJsCollection} ampDoc - jQuery amp document
   * @param {String} selectors - css selector(s)
   * @param {String} boundAttr - bound attribute
   * @param {Object} context - If bound expression has references the "Global" AMP state,
   *  you can provide an Object with keys (amp-state IDs) mapped to root-level amp-state objects.
   * @param {bindExpr} - you can provide your own bind expression
   *  (useful for evaluating amp-bind-macros)
   */
  async ampBeforeRenderBindEval(
    ampDoc,
    selectors,
    boundAttr,
    context,
    bindExprArg
  ) {
    ampDoc.find(selectors).each((i, e) => {
      let elem = $(e);
      let bindExpr = bindExprArg || elem.attr(`[${boundAttr}]`);
      if (!bindExpr) return;

      /* Modify expression to from global amp-state "key" to "this.key"
         to support binding to context object.
         This could be the source of subtle bugs,
         but it does beat the alternative of setting
         these global objects on window for now. */
      for (const key of Object.keys(context)) {
        let contextMatchReg = new RegExp(`(${key})`, "gi");
        bindExpr = bindExpr.replace(contextMatchReg, "this.$1");
      }

      /*
        amp-bind uses a surprising shorthand for many Global functions.
        You may need to backfill for your specific amp-bind expression.
        A list of shorthand functions is available here:
        https://amp.dev/documentation/components/amp-bind/#allowed-listed-functions
      */
      let globalSpec = {
        keys: "Object",
        values: "Object",
      };
      for (const [prop, global] of Object.entries(globalSpec)) {
        //debugger;
        let contextMatchReg = new RegExp(`(${prop})(?!\.com)`, "gi");
        bindExpr = bindExpr.replace(contextMatchReg, `${global}.$1`);
      }

      // Evaluate expression in the amp-state "context"
      let bindFn = new Function(
        "",
        `{
          try {
            // console.log((${bindExpr}).replace(/this./gi, ''));
            return (${bindExpr}).replace(/this./gi, '');
          } catch (ex) {
            // debugger;
            console.log('failed to bind attribute:', ex);
          }
        }`
      ).bind(context);

      elem.attr(boundAttr, bindFn(context));
    });
  }

  ampBeforeRenderCss(ampDoc$, ampBody$, ampDocVersion) {
    ampBody$.addClass("PWAMP");
    ampDoc$.find("style[amp-custom]").each((i, ampCustomStyle) => {
      let css = `
      .PWAMP .pwaOnly.pwaOnly {
          display: revert;
      }
      .PWAMP .pwaOnly.flex {
          display: flex;
      }
      .PWAMP .pwaOnly.pwaOnly.plpPill, .PWAMP .pwaOnly.pwaOnly.localModalToggle {
        display: flex;
      }
      body {
        min-height: 100vh;
      }
      .variableAmpList {
        height: auto!important;
      }
      .variableAmpList > div:not([placeholder]):not([fallback]):not([overflow]) {
        position: static;
        height: auto!important;
        min-height: fit-content!important;
      }
      /* Preload an amp-list to show at desktop resolutions - ex: desktop user acct menu */
      @media (max-width: 79.99rem) {
        .dwPreload.dwPreload {
          display: block !important;
          height: 1px !important;
          opacity: 0;
          overflow: hidden !important;
          position: fixed;
          top: 0;
          width: 100vw !important;
        }
      }

      /* Safari iOS carousel transform was clipping tooltip z-index
      fix for https://bedbathandbeyond.atlassian.net/browse/PREP-9587 */
      .sliderWrap .amp-sacrifice {
        transform: none!important;
      }

      .overflow.overflow,
      .overflow .i-amphtml-carousel-scroll {
        overflow: visible!important;
      }

      #scrollToTopButton {
        transition: opacity 0.4s;
        visibility: hidden;
      }
      #scrollToTopButton.active {
        opacity: 1;
        transition: opacity 0.4s;
        visibility: visible;
      }
      .header .navSelected {
        text-decoration: underline;
        color: var(--priClr);
      }
      /* JW - All temp 10.23.20 */
      #searchcontainer#searchcontainer {
        left: -200vw;
      }
      #searchcontainer#searchcontainer.active {
        left: 0;
      }

      #searchcontainer .recentSearches{
        visibility: hidden;
      }
      #searchcontainer.active .recentSearches{
        visibility: visible;
      }

      #searchcontainer .quickLinks{
        visibility: hidden;
      }
      #searchcontainer.active .quickLinks{
        visibility: visible;
      }

      .linkClearRecent {
        font-size: var(--txtP);
        font-weight: 300;
        letter-spacing: 1px;
      }

      /* JW - PDP temp 10.23.20 */
      .PWAMP .modalImg.active {
        top: 0;
        height: 100vh;
      }

      /* JW - PLP temp 10.23.20  */
      .linkMid {
        color: inherit;
        display: inline-flex;
        align-items: center;
      }
      .absolute.absolute {
        position: absolute;
      }

      /* Helpful form button styling for Q&A and Reviews */
      .reviewsCont {
          border: 2px solid #d6d6d6;
          border-radius: 4px;
          margin: 1rem 0;
          padding: 1rem;
      }
      .helpfulCont {
          display: block;
          max-width: 100%;
          position: relative;
          overflow: hidden;
      }
      .helpfulItems {
          display: flex;
          list-style-type: none;
          margin: 0;
          padding: 0;
      }
      .helpfulIcon {
          height: 16px;
          width: 16px;
      }
      .helpfulLink {
          display: inline-block;
          border: 2px solid #d6d6d6;
          border-radius: var(--btnBorderRad);
          font-size: var(--btnLinkSize);
          font-family: var(--fontMain);
          padding: .3rem .5rem;
          text-decoration: none;
          color: #000;
          font-weight: 300;
          transition: all .5s ease-in;
          background: transparent;
          background-color: #fff;
          cursor: pointer;
      }
      .helpfulLink:active {
          animation: onPressed .25s ease 1;
      }
      .helpfulLink[data-vote="negative"] {
          background-color: var(--btnBg);
          border-color: var(--btnBg);
          color: #fff;
      }
      .helpfulLink[data-vote="negative"] .helpfulIconCont svg {
          fill: #fff;
      }
      .helpfulItems li {
          margin-right: 2px;
      }
      .helpfulCnt {
          font-weight: 600;
      }
      .clGps {
        display: block!important;
      }
      amp-carousel .sliderBadge {
        display:none;
      }
      .collectionsSlider amp-carousel .sliderBadge {
        display: initial;
      }

      /* 11.23 temp */
      .siteRecentList.siteRecentList {
        z-index: 10;
      }

      /* 11.25 temp */
      .holidayMessaging {
        color: #088000;
      }
      #scrollToTopButton#scrollToTopButton {
        bottom: 100px;
      }
      /* payment options 2 */
      .payOption2 {
        margin: 12px 0;
        overflow: hidden;
      }
      .payOption {
        border-bottom: 1px solid #d6d6d6;
        border-top: 1px solid #d6d6d6;
        margin: 12px 0;
        height: 76px;
        overflow: hidden;
      }
      /* Payment options */
      .PWAMP .payOption:not(.hide) {
        display: block;
      }
      #payOptionHeader {
        margin: 10px 0;
      }
      .moreOptions {
        font-weight: bold;
        color: var(--btnLinkColor);
      }
      div#payOption div {
        height: 24px;
        margin: 8px 0;
      }
      .moreOptions .wi.wi-down-arrow {
        vertical-align: middle;
        margin-left: 5px;
      }
      /* Remove this after 5.11.22 release */
      amp-img.klarnaLogo {
        display: inline-block;
        width: 58px;
        height: 37px;
        vertical-align: middle;
        margin: -3px 0 0 -3px;
      }
      /* End remove */
      .paymentOption.paypal,
      .paymentOption.klarna {
        display: none;
      }
      .payOption2 .paymentOption.klarna {
        display: block;
      }

      .klarnaModalWrapper div.modalContent {
        height: unset;
        width: unset;
        padding: 4% 2%;
      }
      .klarnaModalWrapper iframe {
        max-width: 100%;
        max-height: 100%;
      }
      .paymentAmount {
        display: inline-block;
        min-width: 47px;
        text-align: right;
      }

      /* 560px breakpoint comes from klarna */
      @media screen and (min-width: 560px) {
        .klarnaModalWrapper div.modalContent {
          height: 535px;
          width: 559px; /* Force klarna to not use background img */
          min-height: 555px;
          padding: 40px 20px 20px 20px;
          margin: 120px auto 0;
        }
      }
      #wm_contentQv {
        padding: 3rem 1rem;
      }
      .saParent {
        opacity: 0;
        transition: opacity 600ms ease-in-out;
      }
      .onePix.onePix {
        max-height: 1px;
        overflow: hidden;
        margin: 0;
      }
      .tabbedSections,
      #socialAnnexTab {
        min-height: 200px;
      }
      .loading {
        padding: 2rem 1rem;
      }
      .loading span {
        width: 5px;
        height: 5px;
        background: var(--cartCountBg);
        display: inline-block;
        margin-left: 0.3rem;
        border-radius: 50%;
        animation-name: loadingDots;
        animation-duration: 1800ms;
        animation-iteration-count: infinite;
      }
      .loading .dot2 {
        animation-delay: 600ms;
      }
      .loading .dot3 {
        animation-delay: 1200ms;
      }
      @keyframes loadingDots {
        0% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.4);
        }
        100% {
          transform: scale(1);
        }
      }
      /* Used for drag-to-scroll cat nav bar */
      .grab {
        cursor: grab;
      }
      .grab .catBarWrap {
        padding-right: 2rem;
      }
      .navPillsBar.grabbing,
      .navPillsBar.grabbing * {
        cursor: grabbing
      }
      .registryCtaCont {
        display: none;
      }
      /* this needs to ignore expert picks registrycta */
      .activeRegistryCta .registryCtaCont:not(.MSWP) {
        display: block;
        flex-basis: 100%;
      }
      .activeRegistryCta .registryCtaCont.personalize {
        display: none;
      }
      .activeRegistryCta.personalized .registryCtaCont.personalize {
        display: block;
        flex-basis: 100%;
      }
      .activeRegistryCta .registryRow {
        display: none;
      }
      .activeRegistryCta .pdpQtyInputCont:not(.personalize),
      .activeRegistryCta.personalized .pdpQtyInputCont.personalize,
      .activeRegistryCta .fulfillCtaCont:not(.personalize),
      .activeRegistryCta.personalized .fulfillCtaCont.personalize {
        flex-basis: 100%;
      }
      .activeRegistryCta .fulfillCtaCont:not(.personalize),
      .activeRegistryCta.personalized .fulfillCtaCont.personalize {
        padding-left: 0;
        margin-top: 1rem;
      }
      .activeRegistryCta .fulfillCtaCont:not(.personalize) .btnPrimary,
      .activeRegistryCta.personalized .fulfillCtaCont.personalize .btnPrimary {
        border: 2px solid var(--btnPri);
        background-color: #fff;
        color: var(--btnPri);
      }
      .personalized .notPersonalizedMsg, .personalized .notPersonalizedCta {
        display: none;
      }
      .personalized .personalizedCta {
        display: initial;
      }
      .customPreviewCont {
        border: 2px solid #f2f2f2;
      }
      .customPreviewCont b{
          font-weight: 400;
      }
      .customPreview {
          max-width: 70px;
      }
      .activeRegistryCta .fulfillCtaCont .btnPrimary.btnOutOfStock {
        border: 2px solid #e2e2e2;
        color: #888;
        display: unset;
      }
      .activeRegistryCta .fulfillCtaCont .btnPrimary:hover,
      .activeRegistryCta .fulfillCtaCont .btnPrimary:active,
      .activeRegistryCta.personalized .fulfillCtaCont.personalize .btnPrimary:hover {
        background-color: var(--hBackSec);
        border-color: var(--hBackSec);
        color: #fff;
      }
      .activeRegistryCta .registryCtaCont+.btnOutlinePrimary {
        min-height: 50px;
        margin-top: .5rem;
      }
      .registrySelect .registryCtaCont .wiCaret {
        display: inline-block;
      }
      .activeRegistryCta .prodCard .registryCtaCont.shipItOOS.bopisOOS,
      .registryCtaCont .wiCaret,
      .activeRegistryCta.expertPicksCard .epCellCtaLink,
      .activeRegistryCta.expertPicksCard .epCellCtaLink,
      .activeRegistryCta.expertPicksCard .sswpMSWP.registryCtaCont  {
        display: none;
      }
      .activeRegistryCta .prodCardR .registryCtaCont {
        display: flex;
        justify-content: unset;
        align-items: end;
        max-height: 51px;
      }
      .activeRegistryCta .registryCtaCont.SSWP {
        display: flex;
      }
      .regOpt:hover {
        background: #d6d6d6;
        text-decoration: none;
      }
      .regOpt.regDisabled {
        background: #e2e2e2;
        color: #595959;
        pointer-events: none;
      }
      .regFriendLink {
        line-height: 35px;
      }
      .regTitle {
        font-size: 14px;
      }
      /* temporary for the switch to hide personalized products can be removed after 2/16 */
      /
      *@media (min-width: 64rem) {
        .activeRegistryCta .pdpQtyInputCont:not(.personalize),
        .activeRegistryCta.personalized .pdpQtyInputCont.personalize {
          flex-basis: 20%;
        }
        .customPreviewCont button:hover {
          text-decoration: underline;
        }
        .customPreview {
          max-height: 120px;
          max-width: 120px;
        }
        .dGr2 {
          margin-right: 2rem;
        }
      }
      */
      .registryList {
        border: solid 2px #d6d6d6;
        border-radius: 4px;
        box-shadow: 10px 13px 22px 0 rgba(0, 0, 0, 0.2);
        left: 50%;
        max-height: 35vh;
        overflow-y: auto;
        overflow-x: hidden;
        top: 100%;
        transform: translateX(-50%);
        width: 300px;
        z-index: 3;
      }
      .plpV2 .registryList {
        left: unset;
        right: 0;
        transform: none;
      }
      .above {
        top: initial;
        bottom: 110%;
      }
      /* Beyond+ changes for PLP */
      .beyondMember .plpBeyondPlus .regPrice {
        display: none;
      }
      /*
        utility class for hiding things but keeping their layout
        used for subscription.
      */
      .visHidden {
        visibility: hidden;
      }
      /* PLP No Results - CLP and Brand */
      .noResults #plpNoResultsTitle,
      .noResults .nrContainer {
        display: block !important;
      }
      `;

      ampCustomStyle.innerHTML = css + ampCustomStyle.innerHTML;

      if (/ca|baby/i.test(location.hostname)) {
        ampCustomStyle.innerHTML += `
        .beyondPlusWrap.beyondPlusWrap,
        .bPlusWrap.bPlusWrap,
        .priceTitle {
            display: none;
        }`;
      }
      if (/ca/i.test(location.hostname)) {
        // hiding helpful button on reviews from US and Baby
        ampCustomStyle.innerHTML += `
        .noSddMsg,
        .PWAMP .helpfulCont.pwaOnly {
          display: none;
        }
        .PWAMP .helpfulCont.bedbathbeyondca.pwaOnly {
          display: inherit;
        }
        `;

        // temporarily hide zip modal while CA SDD cache clears.
        if (ampDocVersion < 106) {
          ampCustomStyle.innerHTML += `
          #prodDeliverIt .cartLink {
            display: none;
          }
        `;
        }
      }
      // hiding helpful button on reviews from US and Baby
      if (/baby/i.test(location.hostname)) {
        ampCustomStyle.innerHTML += `
              .PWAMP .helpfulCont.pwaOnly {
                  display: none;
              }
              .holidayMessaging {
                color: #b85b0a;
              }
              #scrollToTopButton#scrollToTopButton {
                bottom: calc(4rem + 64px);
              }
              `;
      }
      // hiding helpful button on reviews from US and Baby
      if (!/ca|baby/i.test(location.hostname)) {
        ampCustomStyle.innerHTML += `
              .PWAMP .helpfulCont.pwaOnly {
                  display: none;
              }
              .PWAMP .helpfulCont.bedbathbeyond.pwaOnly {
                display: inherit;
              }`;
      }
      if (!/harmon/i.test(location.hostname)) {
        /* BounceX inserts its own email signup form inside next to the footer. Hide it. */
        ampCustomStyle.innerHTML += `
        #wm_footer > div[id^="bx-campaign"] {
             display: none !important;
          }`;
      }
    });

    // Cross Banner Cart and Checkout Banner alignment
    // let mixedBanner = ampDoc$.find(".mixedBanner");
    // if (this.pwa.session.features.siteCbccBannersCenter) {
    //   mixedBanner.addClass("ctr");
    // } else {
    //   mixedBanner.removeClass("ctr");
    // }

    // CBCC banner direct baby tab to buybuybaby.bedbathandbeyond.com
    // if (this.pwa.session.features.siteCbccEnabled) {
    //   let env = "";
    //   if (this.pwa.session.isPreprod) {
    //     env = location.origin.match(
    //       /(dev01|et01|et02|ee01|ee02|em01|em02|e-www3preview)/
    //     )[1];
    //   }

    //   const newUrl = this.pwa.session.isPreprod
    //     ? `https://${
    //         env +
    //         "baby" +
    //         (/(dev01|e-www3preview)/.test(location.origin) ? "" : "-www")
    //       }.bbbyapp.com`
    //     : "https://buybuybaby.bedbathandbeyond.com";

    //   mixedBanner
    //     .find("#babyLogo")
    //     .attr("href", newUrl)
    //     .attr(
    //       "data-attribute",
    //       "{'url': https://buybuybaby.bedbathandbeyond.com}"
    //     );
    // }

    // PPS-2007 - JW 6.15.21 temporary - add CBCC store-selector classes until amp cache rebuilds
    ampBody$
      .find(".radItm")
      .addClass("s12 whiteBg txtBlk txtLeft borderNone radItm");
  }

  /**
   * Before Render functions for PLP
   * @param {CashJsCollection} ampDoc$ - amp document
   * @param {CashJsCollection} ampBody$ - amp body
   * @param {URL} urlObj - url being loaded
   * @param {obj} changeStore - previously saved user store preferences
   * @param {String} searchPathname (opt) - pathname.search if this is a search page
   *    ex: ?text=blue+steel
   */
  ampBeforeRenderPlp(ampDoc$, ampBody$, urlObj, changeStore, searchPathname) {
    const isPLPReg = this.pwa.session.docTests.isPLPReg;
    const isBrandReg = this.pwa.session.docTests.isBrandReg;
    const isCLPReg = this.pwa.session.docTests.isCLPReg;
    const pathAndSearch = `${urlObj.pathname}${urlObj.search}`;
    if (
      !(isPLPReg.test(pathAndSearch) || isBrandReg.test(pathAndSearch)) ||
      (isCLPReg.test(pathAndSearch) &&
        !/category\/clearance/i.test(pathAndSearch))
    )
      return;

    this.pwa.session.ampStateUnstable = true;

    if (!this.pwa.session.features.enableMarketplace) {
      // This should remove anything inside the marketplace flag
      this.pwa.util.replaceStringInTemplate(
        ampBody$,
        /\{\{\#MARKETPLACE_ITEM_FLAG\}\}.+?(?=\{\{\/MARKETPLACE_ITEM_FLAG)\{\{\/MARKETPLACE_ITEM_FLAG\}\}/gi,
        " ",
        "plpTemplate"
      );
      this.pwa.util.replaceStringInTemplate(
        ampBody$,
        /\{\{(\#|\^|\/)MARKETPLACE_ITEM_FLAG\}\}/gi,
        " ",
        "plpTemplate"
      );
    }

    /**
           Update apiUrl from URL params.
           2.6.21 example apiUrl object:
            <amp-state id="apiUrl">
              <script type="application/json">
                {
                    "activeFacetId": "inStockOnline",
                    "dep_clicked": "",
                    "facets": {},
                    "inStockOnline": "",
                    "nearestStoresParam": "",
                    "page": 0,
                    "pageParam": "&start=0&perPage=~~plpItmCt~~",
                    "perPage": ~~plpItmCt~~,
                    "rangedFacets": {},
                    "removeInStock": "",
                    "sddZipParam": "",
                    "searchTerms": "",
                    "searchParam": "&sws=",
                    "sort": "~~plpSortSetting~~",
                    "sortName": "Best Match",
                    "storeOnlyParam": "&storeOnlyProducts=false"
                }
                </script>
              </amp-state>
           */
    const apiUrl = JSON.parse(ampDoc$.find("#apiUrl").text());

    /* BOPIS & SDD related options
          ex: 1.1.21
          <amp-state id="changeStore">
            <script type="application/json">
                {
                    "csModal": false,
                    "location": null,
                    "radius": 25,
                    "radiusModal": false,
                    "showErr": false,
                    "ssModal": false,
                    "storeId": null
                    "nearestStores": null,
                    "sddActive": false,
                    "sddActiveSearch": false,
                    "storeId": "",
                    "storeOnly": false,
                }
            </script>
          </amp-state>
          */
    changeStore = changeStore || {
      storeId: null,
    };

    // Disable 48 & up per page - We are running into amp-bind max expression limit (1000 expressions)
    // if (window.innerWidth >= 1280) {
    //   // modify per page to 48
    //   apiUrl.perPage = 48;
    //   apiUrl.pageParam = "&start=0&perPage=48";
    // }

    // parse url and set apiUrl facets
    // see if this URL matches the PLP facets patter
    let parsedUrl = this.pwa.session.parsedURL || {};

    /** init apiUrl with Pathname Segments **/
    // TODO parse url
    // 1. Search term - from facet sidebar, not Search url.
    if (parsedUrl.searchTerms) {
      apiUrl.searchTerms = parsedUrl.searchTerms;
      apiUrl.searchParam = `&sws=${encodeURIComponent(parsedUrl.searchTerms)}`;
    }

    // 3. Pagination
    if (parsedUrl.page) {
      apiUrl.page = parsedUrl.page;
      apiUrl.perPage = parsedUrl.perPage;
      apiUrl.pageParam = `&start=${
        parsedUrl.page * parsedUrl.perPage
      }&perPage=${apiUrl.perPage}`;
    }

    // 4a. BOPIS - "Free 2 hour pickup" checkbox
    if (parsedUrl.storeId) {
      Object.assign(apiUrl, {
        sddZipParam: "",
        storeOnlyParam: `&storeOnlyProducts=true&storeId=${parsedUrl.storeId}`,
      });
      Object.assign(changeStore, {
        sddActive: false,
        sddActiveSearch: false,
        storeId: parsedUrl.storeId,
        storeOnly: true,
      });
    }

    // 4ab. BOPIS checked - from college landing page, only for college users
    // https://bedbathandbeyond.atlassian.net/browse/COL-1009
    if (this.pwa.college.isCollege && urlObj.searchParams.get("fromCollege")) {
      let collegeStoreId = changeStore.storeId
        ? changeStore.storeId
        : this.pwa.college.favoriteStore
        ? this.pwa.college.favoriteStore.storeId
        : "";
      if (collegeStoreId) {
        Object.assign(apiUrl, {
          sddZipParam: "",
          storeOnlyParam: `&storeOnlyProducts=true&storeId=${collegeStoreId}`,
        });
        Object.assign(changeStore, {
          sddActive: false,
          sddActiveSearch: false,
          storeId: collegeStoreId,
          storeOnly: true,
        });
      }
    }

    // 4b. SDD - "Same Day Delivery" checked
    if (parsedUrl.sddZipcode) {
      Object.assign(apiUrl, {
        sddZipParam: `&isSDDChecked=true&sddAttr=13_1&sddAttribute=13_1&sddZip=${parsedUrl.sddZipcode}`,
        storeOnlyParam: `&storeOnlyProducts=false&storeId=${changeStore.storeId}`,
      });
      Object.assign(changeStore, {
        sddActive: true,
        sddActiveSearch: true,
        sddZipcode: parsedUrl.sddZipcode,
        nearestStores: null,
        storeOnly: false,
      });
    }
    // 5. Encoded facet segment is always last
    if (parsedUrl.facets) {
      apiUrl.facets = this.pwa.site.getAppliedFacetsFromBase64(
        parsedUrl.facets
      );
      // Update canonical and alternate link tags with faceted url
      $('head link[rel="canonical"], head link[rel="alternate"]').each(
        (i, e) => {
          const urlObj = new URL(e.href);
          e.href = urlObj.origin + this.pwa.session.parsedURL.fullPath;
        }
      );

      $('head link[rel="amphtml"]').attr(
        "href",
        location.origin + "/amp" + this.pwa.session.parsedURL.fullPath
      );
      $('head meta[property="og:url"], head meta[name="twitter:url"]').attr(
        "content",
        location.origin + this.pwa.session.parsedURL.fullPath
      );

      if (this.pwa.session.parsedURL.friendlyFacets) {
        // Update title tags and meta descriptions with faceted plp title
        const sanitizedFriendlyFacet = this.pwa.session.parsedURL.friendlyFacets
          .replaceAll(/-|_/g, " ")
          .replace("  ", " ")
          .trim()
          .split(" ")
          .map((word) => word[0].toUpperCase() + word.substr(1))
          .join(" ");

        const concept = this.pwa.session.isBABY
          ? "Buy Buy Baby"
          : this.pwa.session.isHARMON
          ? "Harmon Face Values"
          : "Bed Bath & Beyond";

        $("head title").text(`${sanitizedFriendlyFacet} | ${concept}`);
        $(
          'head meta[property="og:title"], head meta[name="twitter:title"]'
        ).attr("content", `${sanitizedFriendlyFacet} | ${concept}`);

        $(
          'head meta[name="description"], head meta[property="og:description"], head meta[name="twitter:description"]'
        ).attr(
          "content",
          `Shopping for ${sanitizedFriendlyFacet}? Explore ${concept}'s wide selection and take advantage of incredible savings. Free shipping available.`
        );

        $("head meta[name*=keyword]").attr("content", sanitizedFriendlyFacet);
      }
    }

    /** init apiUrl with Query Parameters **/

    // a. Sorting
    const sortNameMap = {
      "LOW_PRICE%20asc": "Price - Low to High",
      "LOW_PRICE%20desc": "Price - High to Low",
      "RATINGS%20desc%2CREVIEWS%20desc": "Top Rated",
      "BRAND%20asc": "Brand",
      "ENABLE_DATE%20desc": "Newest Arrivals",
      "MOST_POPULAR%20desc": "Most Popular",
      "DISCOUNT_d%20asc": "Discount - Low to High",
      "DISCOUNT_d%20desc": "Discount - High to Low",
    };
    const sortParam = urlObj.searchParams.get("sort");
    // PP-2986, PP-3060 BEST_MATCH is default;
    // exclude from params to avoid unhandled API issue on BBB side (from Registry Checklist)
    if (sortParam && sortParam != "BEST_MATCH") {
      apiUrl.sort = `&sort=${sortParam}`;
      apiUrl.sortName = sortNameMap[sortParam];
    }
    // b. In Stock Online
    const inStockOnlineParam = urlObj.searchParams.get("inStockOnline");
    if (inStockOnlineParam)
      apiUrl.inStockOnline = `&inStockOnline=${inStockOnlineParam}`;

    // c. Remove In Stock - in stock online deselected, BOPIS, SDD
    const removeInStockParam = urlObj.searchParams.get("removeInStock");
    if (removeInStockParam)
      apiUrl.removeInStock = `&removeInStock=${removeInStockParam}`;

    // d. Nearest Stores (paired with store param)
    const nearestStoresParam = urlObj.searchParams.get("nearestStores");
    if (nearestStoresParam)
      changeStore.nearestStores = nearestStoresParam.split(",");

    /* If user has selected a store, or have custom facets
          update amp-lists to initialize with storeID */
    if (changeStore.storeOnly) {
      // sync apiUrl with previous user choices
      //apiUrl.storeOnly = true;
      Object.assign(apiUrl, {
        removeInStock: "&removeInStock=true",
        storeOnlyParam: `&storeOnlyProducts=true&storeId=${changeStore.storeId}`,
        sddZipParam: "",
      });
    }

    function parsePriceFacet(priceRange) {
      let rangedFacet;
      priceRange.forEach((range) => {
        const [min, max] = range.match(/[0-9]+/g);
        rangedFacet = { min: min, max: max };
      });
      return rangedFacet;
    }
    // Set apiUrl.customPriceRange
    const priceParam = urlObj.searchParams.get("customPriceRange");
    if (priceParam == "true") {
      apiUrl.rangedFacets.LOW_PRICE = parsePriceFacet(apiUrl.facets.LOW_PRICE);
      apiUrl.customPriceRange = true;
    }

    // Initialize search pages with Same day delivery parameter
    // All other PLP pages are not initialized.
    // See ChangeStore.sddActive earlier in this function.
    if (
      searchPathname &&
      changeStore &&
      changeStore.sddActiveSearch &&
      changeStore.sddZipcode
    ) {
      const sddZipParam = this.pwa.session.isCANADA
        ? changeStore.sddZipcode.slice(0, 3)
        : changeStore.sddZipcode;
      Object.assign(apiUrl, {
        removeInStock: "&removeInStock=true",
        sddZipParam: `&isSDDChecked=true&sddAttr=13_1&sddAttribute=13_1&sddZip=${sddZipParam}`,
        storeOnlyParam: `&storeOnlyProducts=false&storeId=${changeStore.storeId}`,
      });
    }

    // Initialize all PLPs with Store only parameter, if present
    if (changeStore && changeStore.storeId) {
      if (changeStore.storeOnly) {
        Object.assign(apiUrl, {
          removeInStock: "&removeInStock=true",
          storeOnlyParam: `&storeOnlyProducts=true&storeId=${changeStore.storeId}`,
        });
      } else {
        // https://jira.bedbath.com/browse/PREP-8717?filter=127621
        // Per Mehul's request: Provide storeId if we have one.
        // Actual request was "If user has selected" a store, so we may need to revisit this.
        Object.assign(apiUrl, {
          storeOnlyParam: `&storeOnlyProducts=false&storeId=${changeStore.storeId}`,
        });
      }
    }

    // PD-2047 - remove in stock was not working correctly so adding check for param in url
    if (/removeInStock=true/.test(location.search)) {
      Object.assign(apiUrl, {
        removeInStock: "&removeInStock=true",
      });
    }

    this.ampSetStateBeforeRender(ampDoc$, "apiUrl", apiUrl);
    this.ampSetStateBeforeRender(ampDoc$, "changeStore", changeStore);
    //debugger;
    const prodListSrc = ampDoc$.find("#prodListSrc").attr("expression");
    this.ampBeforeRenderBindEval(
      ampDoc$,
      `[data-prod-list-src]`,
      "src",
      {
        apiUrl: apiUrl,
        storeId: changeStore.storeId,
        changeStore: changeStore,
      },
      prodListSrc
    );

    // Update Criteo IDs - 6.14.21
    // If we still have desktop IDs, switch to mobile
    // XXX - MCM - This is temp - Once rebuilt, the new AMPs should now have the mobile container IDs by default.
    // This can be deleted once the PDPs have all been rebuild, maybe in about a month? 7/14/21
    // if (window.innerWidth < 768) {
    //   ampDoc$
    //     .find("#viewSearchResult-SearchListing")
    //     .attr("id", "viewSearchResult_mobile-SearchListing");
    //   ampDoc$
    //     .find("#viewCategory-BrowseListing")
    //     .attr("id", "viewCategory_mobile-BrowseListing");
    // }

    // 2.3.21 - JW Temp
    // ampDoc$.find("#socialAnnex").attr("id", "socialannex");

    // this.pwa.plpLeftTest.plpLeftBeforeRender(ampDoc$, urlObj);

    // Adjust PLP ad spacing
    this.pwa.desktop.ampBeforeRenderPlp(ampDoc$);

    // Mobile product list
    if (this.pwa.desktop.isDesktop)
      ampDoc$.find("#plpListInner")[0].removeAttribute("[hidden]");
  }

  /**
   * Place bound elements from current document in next document so that
   * multi-doc amp framework does not forget about the bindings.
   *
   * Note: Assumes 2 hosts. amp-binding sync this will need to become more
   * sophisticated if we ever add more than 2 hosts.
   *
   * @param {CashJsCollection} ampBody$ - amp body of target amp-document
   */
  ampBeforeRenderBindingSync(ampBody$) {
    // return if no bindings to sync
    if (
      !(
        this.pwa.session.boundAttrsAll && this.pwa.session.boundAttrsAll.length
      ) &&
      !this.pwa.session.boundAttrsDiv
    )
      return;

    // docObjActive is still current doc, ampBody$ is not attached to DOM yet.
    let ampDocObj = this.pwa.session.docObjActive;

    let boundAttrsDiv;
    if (this.pwa.session.boundAttrsDiv) {
      // user is loading new doc in same host. copy any existing bindings.
      boundAttrsDiv = $(this.pwa.session.boundAttrsDiv);
    } else {
      // user is loading new doc in other host. create new boud attrs div.
      boundAttrsDiv = $(
        `<div id="peerAmpDocBindings" data-doc-num="${ampDocObj.docnum}" class="hide"><div>`
      );
      this.pwa.session.boundAttrsAll.forEach((elem) => {
        try {
          let id = elem.id;
          if (id && ampBody$.find(`#${id}`).length) return;
          else boundAttrsDiv.append(elem);
        } catch (e) {}
      });
    }
    ampBody$[0].insertAdjacentHTML("beforeend", boundAttrsDiv.outerHTML());
    this.pwa.session.boundAttrsAll = [];
    this.pwa.session.boundAttrsDiv = null;
  }

  /**
   * Reuses a single AMP page for all search terms
   * @param {CashJsCollection} ampDoc - jQuery-like Document or ampList object
   * @param {string} searchPathname - url pathname
   * @returns undefined - modifies provided ampDoc
   */
  async ampBeforeRenderReplaceSearchTerm(ampDoc, searchPathname) {
    if (!ampDoc || !searchPathname) return;
    let replacedTerm = this.pwa.session.searchTemplateTerm;

    let ampBody = ampDoc.find("body");
    if (!ampBody.length) ampBody = ampDoc.closest("body");

    // support ?wmDoNotQueue transtion from /store/s/comforter to /store/s/wmsearchtemplate,
    if (ampBody.hasClass("store_s_comforter")) {
      replacedTerm = this.pwa.session.searchTemplateTerm = "comforter";
    }

    // If we are replacing search term at the document level,
    // proceed only if we are dealing with the /store/s/comforter page.
    // Do not replace terms if document is a long tail ?wmDoNotQueue=1 search page.
    if (!ampBody.hasClass(`store_s_${replacedTerm}`)) return;

    const replaceReg = new RegExp(replacedTerm, "gi");

    const replaceTerm = (e, type, term) => {
      try {
        e[type] = e[type].replace(replaceReg, term);
      } catch (err) {
        if (e.parentNode.nodeType == 11) {
          // console.log("element is direct child of a DOM fragement");
          const wrapper = document.createElement("span");
          e.parentNode.insertBefore(wrapper, e);
          wrapper.appendChild(e);
          e[type] = e[type].replace(replaceReg, term);
        }
      }
    };

    // ex: https://www.bedbathandbeyond.com/store/s/comforter/_pink/dmlzdWFsVmFyaWFudC5ub252aXN1YWxWYXJpYW50LlNLVV9GT1JfU1dBVENILkNPTE9SX0dST1VQOiJQaW5rIg==
    const searchTermMatch = /^\/store\/s\/([^\/]+)/i.exec(
      decodeURIComponent(searchPathname)
        .replace(/\"|\'/gi, "-")
        .replace(/_/gi, '"')
    );
    if (!searchTermMatch) return;

    // href components
    let searchTerm = searchTermMatch[1];
    $(this.pwa.$$$(ampDoc[0], '[data-search-replace="href"]')).each((i, e) =>
      replaceTerm(e, "outerHTML", searchTerm.replace(/"/gi, "_"))
    );

    // text content
    const searchTermText = searchTerm.replace(/-/gi, " ");
    $(this.pwa.$$$(ampDoc[0], '[data-search-replace="text"]')).each((i, e) =>
      replaceTerm(e, "outerHTML", searchTermText)
    );

    // url components
    const searchTermEncoded = encodeURIComponent(searchTermText);
    $(this.pwa.$$$(ampDoc[0], '[data-search-replace="src"]')).each((i, e) =>
      replaceTerm(e, "outerHTML", searchTermEncoded)
    );
    // Product Card link decoration ex: ?keyword=yellow&color=YELLOW&size=QUEEN&skuId=45459122
    const keywordReg = new RegExp(`\\?keyword=${replacedTerm}`, "gi");
    ampDoc.find("#plpTemplate").each((i, e) => {
      e.innerHTML = e.innerHTML.replace(
        keywordReg,
        `?keyword=${searchTermEncoded}`
      );
    });

    // element attributes
    const searchTermAttr = this.pwa.util.attrEncode(searchTerm);
    $(this.pwa.$$$(ampDoc[0], '[data-search-replace="attr"]')).each((i, e) =>
      replaceTerm(e, "outerHTML", searchTermAttr)
    );
    // meta descriptions
    ampDoc
      .find("head")
      .find(`meta[name="description"], meta[property="og:description"]`)
      .attr(
        "content",
        `Shop for ${searchTermAttr} at Bed Bath &amp; Beyond. Shop online or in-store at Bed Bath & Beyond for the best ${searchTermAttr} products! Plus, create a wish list with a wedding or gift registry. Shop now!`
      );
  }

  // todo add amphtml link tag to all pages RL
  // call from ampBeforeRender
  /** Add required SEO properties to ampDoc
   * @param {CashJsCollection} ampDoc$ - amp document
   */
  ampBeforeRenderSeo(ampDoc$) {
    // amphtml tag now handled in mod_head_seo (Home, CLP, PLP) and PDP after-render
    // const ampTagHref = ampDoc$[0].URL.replace(/.com/, ".com/amp")
    //   .replace(/\.ca/, ".ca/amp")
    //   .replace(/\?.*/, "");
    // $("head").append(`<link rel="amphtml" href="${ampTagHref}"/>`);

    // Move structured data from ampDoc body to appshell body, removing any existing ones from appshell first
    if (this.pwa.session.features.bodyStructuredData) {
      $("body").find("#schemaGraph").remove();
      $("body").append(ampDoc$.find("#schemaGraph").remove());
    }
  }

  /**
   * Hydrates document with persistent ampState.
   * You can define IDs for amp-state to store in:
   *  session.amp_sessionStorageIds
   *  session.amp_localStorageIds
   *
   * @param {CashJsCollection} doc - The amp document fragment
   * @returns {Promise} - Resolves once amp document is hydrated from either:
   *  this.session
   *  localStorage or sessionStorage
   */
  ampBeforeRenderStorageSync(doc) {
    ["sessionStorage", "localStorage"].map(async (storageType) => {
      let storageKey = `amp_${storageType}`;

      /* Object mapping amp-state Ids to amp-state objects
      Check this.session first */
      let storageObj = this.pwa.session[storageKey];

      /* If we don't have storageObj on this.pwa.session, check local/session storage */
      if (Object.keys(storageObj).length == 0) {
        try {
          storageObj = JSON.parse(window[storageType].getItem(storageKey));
        } catch (e) {}
        if (storageObj) this.pwa.session[storageKey] = storageObj;
      }

      // No persistent amp-state objects found
      if (!storageObj) return;

      // // 11.16.20 - remove localStorage reference that was ported to sessionStorage.
      // // This should only affect a small number of testers, so we can remove this in January '21
      // if (storageKey == "amp_localStorage" && storageObj.changeStore) {
      //   delete storageObj.changeStore;
      //   try {
      //     localStorage.setItem("amp_sessionStorage", storageObj);
      //   } catch (ex) {}
      // }

      // Set pending document amp states to match persistent amp-state objects found
      for (const [ampStateId, ampStateObj] of Object.entries(storageObj)) {
        this.ampSetStateBeforeRender(doc, ampStateId, ampStateObj);
      }
    });
  }

  /**
   * Remember user-selected amp-state between page navigations and user sessions.
   *
   * 1. Collect amp-bindings on this.pwa.session.boundAttrsAll for ampBeforeRenderBindingSync.
   * This is necessary for AMP to remember bindings when navigating
   * between multiple documents.
   *
   * 2. Store persistent amp-state in local or session storage.
   * Define amp-state Ids to be stored in:
   *  session.amp_sessionStorageIds
   *  session.amp_localStorageIds
   *
   * Note: Assumes 2 hosts. amp-binding sync this will need to become more
   * sophisticated if we ever add more than 2 hosts.
   */
  async ampBeforeUnload(docObjNext) {
    const docObjActive = this.pwa.session.docObjActive;
    if (!docObjActive) return;

    // Persist bindings from current document in AMP runtime.
    const activeBody = docObjActive.shadowBody;
    if (!activeBody) return;

    let boundAttrsAll = [];
    const activeDocNum = docObjActive.docnum;

    // Prevent amp-bind binding memory leak:
    //   Remove binding div (from previous ampBeforeRenderBindingSync)
    //   if the current document's binding div is for the document we are loading.
    let boundAttrsDiv = activeBody.querySelector("#peerAmpDocBindings");
    if (
      boundAttrsDiv &&
      boundAttrsDiv.getAttribute("data-doc-num") == docObjNext.docnum &&
      !this.pwa.session.popStateInProgress
    ) {
      boundAttrsDiv.remove();
      boundAttrsDiv = null;
    }

    // If navigating to a new document. scrape current expressions
    if (activeDocNum !== docObjNext.docnum) {
      // appending doc in other host.
      // store binding expressions to place on new document.
      // This is not a complete list of bound attributes, we can add as necessary
      let boundAttrsSelector =
        [
          "class",
          "controls",
          "disabled",
          "hidden",
          "is-layout-container",
          "max",
          "min",
          "height",
          "href",
          "selected",
          "slide",
          "src",
          "text",
          "type",
          "value",
          "width",
        ]
          .map((attr) => `[\\[${attr}\\]]`)
          .join(",") +
        ", amp-bind-macro, [data-amp-bind-checked], #reviewFilters";
      let boundAttrsAll = [
        $('<template id="emptyTemplate" type="amp-mustache"></template>')[0],
      ].concat(Array.from(activeBody.querySelectorAll(boundAttrsSelector)));
      boundAttrsAll = boundAttrsAll.filter(
        (elem) =>
          !elem.closest("#peerAmpDocBindings") &&
          !elem.closest("#headerWrap") &&
          !elem.closest(".offersWrap") &&
          !elem.closest("#wm_footer")
      );
      boundAttrsAll = boundAttrsAll.map((elem) => {
        const elemCopy = elem.cloneNode("false");
        elemCopy.setAttribute("hidden", true);
        if (elemCopy.tagName == "AMP-LIST") {
          // TODO - shorten
          elemCopy.removeAttribute("is-layout-container");
          elemCopy.removeAttribute("i-amphtml-layout");
          elemCopy.removeAttribute("class");
          elemCopy.setAttribute("template", "emptyTemplate");
          elemCopy.setAttribute("layout", "fixed-height");
          elemCopy.setAttribute("height", "1px");
        }
        elemCopy.innerHTML = "";
        return elemCopy;
      });
      this.pwa.session.boundAttrsAll = boundAttrsAll;
    } else if (activeDocNum == docObjNext.docnum && boundAttrsDiv) {
      // replacing doc in current host, copy binding div
      this.pwa.session.boundAttrsDiv = boundAttrsDiv;
    }

    //clear out breadcrumb data on page unload
    if (this.pwa.session.pdpBreadcrumb) {
      this.pwa.session.pdpBreadcrumb = [];
    }
    //scrapping breadcrumbs from PLP/search page when navigating to PDP.
    try {
      if (
        this.pwa.session.docTests.isPLPReg.test(docObjActive.href) ||
        this.pwa.session.docTests.isSearchReg.test(docObjActive.href)
      )
        this.pwa.session.pdpBreadcrumb =
          this.pwa.plp.getPlpBreadcrumbs(activeBody);
    } catch (e) {
      console.warn(`Unable to parse breadcrumbs. Default to PDP breadcrumbs`);
    }

    // Persist some amp-states from current document in window storage.
    await this.ampStoreAmpStates();

    // update dynSessionConfNumberValidity=true cookie for logged in users in order for amp-user-info to return user name
    await this.pwa.user.ampBeforeUnload();
  }

  /**
   * Try to get the amp runtime to render an element that might have not been visible
   * @param {HTMLElement} ampElement - the element we want to trigger load for
   */
  ampElementLayoutNudge(ampElement) {
    if (!ampElement) return;

    if (ampElement.hasAttribute("data-no-nudge")) return;

    if (
      ampElement["__AMP__RESOURCE"] &&
      ampElement["__AMP__RESOURCE"].isLayoutPending &&
      ampElement["__AMP__RESOURCE"].isLayoutPending() &&
      ampElement["__AMP__RESOURCE"].startLayout
    ) {
      try {
        // if (this.pwa.session.isStaging)
        //console.log("Nudged: " + ampElement.tagName.toLowerCase());
        ampElement["__AMP__RESOURCE"].layoutScheduled(Date.now);
        ampElement["__AMP__RESOURCE"].startLayout(Date.now).catch();
      } catch (ex) {
        console.error(
          "Unable to start layout on AMP element\n",
          ampElement,
          ex
        );
      }
    }
  }

  /**
   * Loads amp-list if it hasn't rendered by the time they have
   * entered the viewport.
   *
   * @param {Pwa} pwa - document loader
   * @param {IntersectionObserverEntry} entry - ampImg entry to evaluate
   */
  async ampListLayoutNudge(pwa, intersect) {
    if (intersect.intersectionRatio > 0) {
      function createNudge(list, pwa) {
        return function () {
          if (!$(list).hasClass("i-amphtml-layout")) {
            pwa.amp.ampElementLayoutNudge(list[0]);
          }
        };
      }
      let ampList = $(intersect.target);
      if (!ampList.hasClass("i-amphtml-layout")) {
        let nudge = createNudge(ampList, pwa);
        setTimeout(nudge, 700);
        //Unregister observer
        return pwa.intersectHandlerUnregister("listNudge", intersect.target);
      }
    }
  }

  /**
   * Loads amp-imgs if amp-framework hasn't found them by the time they
   * enter the viewport.
   *
   * This can be necessary in a few situations:
   *   1. a multi-doc environment where the host elements scroll
   *   2. horizontally scrolling elements with amp-imgs
   *   3. variable amp-lists interfering with amp layout calculations
   *
   * @param {Pwa} pwa - document loader
   * @param {IntersectionObserverEntry} entry - ampImg entry to evaluate
   */
  ampImgLoadCheck(pwa, entry) {
    /* note: 'this' is bound to null in this callback */
    const ampImg = entry.target;

    /* Don't nudge, unregister io:
            1. images in the viewport during io.observe registration
            2. images that AMP framework has already lazy loaded */
    if (ampImg.classList.contains("i-amphtml-layout"))
      return pwa.intersectHandlerUnregister("wmNudge", ampImg);

    // Don't nudge, keep io: images outside of viewport.
    if (entry.intersectionRatio == 0) return;

    /* Nudge, unregister io: when an amp-img is entering viewport.
             intersection observer was fired going from 0 to 1 (intersectionRatio ex: 0.123...) */
    pwa.intersectHandlerUnregister("wmNudge", ampImg);
    pwa.amp.ampElementLayoutNudge(ampImg);
    return;
  }

  /**
   * Modify new amp list content after it has been added to the DOM.
   * Note: This is run every time an amp-list receives new content,
   * which can happen fairly often on amp-bind triggers.
   *
   * NOTE:
   * 1. If you have expensive JS that only applies to one amp-list,
   * make sure you limit it by identifying the amplist by ID or some other means.
   * 2. This may be called multiple times in quick succession,
   * especially if you are binding the amp-list source to an amp-state.
   * If your function is expensive, please check if it still needs to run or is currently running.
   *
   * @param {HTMLElement} ampList - amp-list that has new content
   */
  async ampListPostRender(ampListElem) {
    const ampList = $(ampListElem);
    let isHandled;

    /*** Sitewide mods ***/

    // Ensure that form[data-pwa-handler] are only handled by PWA, not AMP framework
    this.pwa.site.formPwaHandlerOnly(ampList);

    // amp scroll handlers don't work in multi-doc environment
    // when the host elements are scrollable.
    this.ampScrollToHandlersRegister(ampListElem);

    // register intersection handler for amp document prefetch links found in amp-list
    this.pwa.intersectHandlersRegister(
      "wmPrefetch",
      ampListElem,
      "a[data-prefetch]",
      this.pwa.prefetch.prefetchHandlerDelay
    );

    this.pwa.dataEventHandlerRegister(ampList);

    // register intersection handler for amp document prefetch links found in amp-list
    // Shouldn't have intersection handler calling a function that is returning
    // this.pwa.intersectHandlersRegister(
    //   "wmNudge",
    //   ampListElem,
    //   "amp-img:not(.i-amphtml-layout), amp-youtube:not(.i-amphtml-layout)",
    //   this.ampImgLoadCheck
    // );

    if (ampList.is(".pencilBannerAL") || ampList.is("#pencilBannerAL")) {
      // Appending btn to p element so that it can be colored dynamically
      ampList.find("#pencilBannerWrap > :first-child").append(
        `<button
          class="pwaOnly vp05 gp05 absolute flex midCtr borderNone btn pencilBannerClose modalCloseJs"
          aria-label="Close Marketing Banner"
        >
          <svg class="wi wiClose noTap">
            <use xlink:href="#wiClose"></use>
          </svg>
        </button>`
      );
    }

    // Make categories bar draggable because the scrollbar is hidden
    // Isn't conditional on isDesktop because there could be non-mobile browser window < 768 at page load
    // But navDskCategoryDragScrollRegister DOES include check if categories fit in the window and only enables dragging if necessary, and reevaluates on window resize.
    if (ampList.is("#navCategoriesBar")) {
      this.pwa.navPanel.navDskCategoryDragScrollRegister(ampList);
      // Preload navigation for bots
      if (/googlebot/i.test(navigator.userAgent))
        this.pwa.navPanel.botNavRender(ampList);
    }

    // JW TODO - remove after 10.21.21 rebuild
    // Find shop all... links and move to top, and show arrow
    // if (ampList.is("#navLayer1List")) {
    //   // navV1, navV2
    //   ampList.find(".nav1Col a").each((i, e) => {
    //     if (/shop all/i.test(e.innerText)) {
    //       e.classList.add("placeFirst");
    //       const svg = e.querySelector("svg");
    //       if (svg) svg.removeAttribute("hidden");
    //     }
    //   });
    // }

    // navV4 - temporary until Rabith get's shop all attribute in contentStack
    // prepend shop all links
    if (
      ampList.is(".navLayer2List.catNav") &&
      ampList.closest("body").hasClass("navV4") &&
      !this.pwa.desktop.isDesktop
    ) {
      const nav2Col = ampList.find(".nav2Col");
      nav2Col.find(".nav2Col a").each((i, e) => {
        if (/shop all/i.test(e.innerText)) {
          // `<svg viewBox="0 0 21.41 10.83" class="wi noTap"><path d="M16 10.83l-1.41-1.42 3-3H0v-2h17.59l-3-3L16 0l5.41 5.41L16 10.83z" /></svg>`
          const svg = e.querySelector("svg");
          if (!svg)
            $(e).append(
              `<svg class="gl1 wi wiArrow noTap dskWHide">
                <use xlink:href="#arrow"></use>
              </svg>`
            );
          nav2Col.find(".navBack").before(e);
        }
      });
    }

    // Cart error recommendataion list
    // hide the show all button if less than 3 items
    if (ampList.is("#alStoreStockResults")) {
      if (ampList.find(".ssItm").length < 4)
        ampList.find(".showAllCont").remove();
    }

    // update with registry dom, if the user has a registry
    if (
      this.pwa.session.features.registryEnable &&
      ampList.is("#navLayer2List") &&
      this.pwa.user.hasRegistry
    ) {
      try {
        ampList
          .find("#registryNav")
          .html(this.pwa.registry.registryNav.innerHtml);
      } catch (e) {
        console.warn(`Error adding registry nav. Error: ${e}`);
      }
    }

    // Format category titles to only be L3 category instead of whole tree
    // i.e., 'coffee' instead of 'kitchen > coffee & tea > coffee'
    if (ampList.is("#topProdList")) {
      ampList.find(".topProdHead").each((i, e) => {
        const e$ = $(e);
        const eTxt = e$.text();
        const eMatch = eTxt.match(/>\s([a-z0-9\s]*)"$/i);
        if (eMatch) e$.text(eTxt.replace(/".*"/, `"${eMatch[1]}"`));
      });
    }

    if (ampList.is(".sizesList")) {
      ampList.find(".sizeLabel").each((i, e) => {
        let lbl$ = $(e);
        // seems like the html entity is double encoded.
        lbl$.html(lbl$.text().replace(/\&amp;/gi, "&"));
      });
    }

    if (ampList.is("#reviewsFull") && !ampListElem.io) {
      ampListElem.io = new IntersectionObserver(
        (entries) => {
          for (let entry of entries) {
            if (entry.intersectionRatio == 1) {
              $(entry.target).trigger("click");
            }
          }
        },
        {
          root: $("#reviewsSection")[0],
          rootMargin: "0px 0px 100% 0px",
          threshold: 1,
        }
      );
      ampList.find("#reviewsLoadMore").each((i, prodName) => {
        ampListElem.io.observe(prodName);
      });
      return;
    }

    /* JK 3.23.21 this loads an amp list for facet overflow.
    https://em02-www.bbbyapp.com/store/s/-kitchen-organization/_better-houseware#development=1 */
    // TODO - can this be removed now that plp left rail is built-in?
    // if (
    //   !this.pwa.session.features.plpLeft &&
    //   (ampList.is("#facetsList") || ampList.is("#dskFacetsList"))
    // ) {
    //   let overflow = ampList.find(".plpFacetOverflow");
    //   if (overflow.length > 0) {
    //     // Replace search term in API call.
    //     if (this.pwa.session.docTests.isSearchReg.test(location.pathname)) {
    //       this.pwa.amp.ampBeforeRenderReplaceSearchTerm(
    //         ampList,
    //         location.pathname
    //       );
    //     }

    //     // Manually trigger amp-list
    //     this.pwa.intersectHandlersRegister(
    //       "facetOverflow",
    //       ampList,
    //       ".plpFacetOverflow",
    //       this.pwa.amp.ampListLayoutNudge
    //     );
    //   }
    //   // Desktop Dropdown menus - hide menus that wrap on Tablet media queries
    //   // https://em02-www.bbbyapp.com/store/category/dining/table-linens/tablecloths/12142/?wmPwa
    //   if (ampList.is("#dskFacetsList")) {
    //     this.pwa.desktop.plpDropdownFacetRender(ampList);
    //   }

    //   return;
    // }

    // PLP Left rail amp-list functions
    // this.pwa.plpLeftTest.plpLeftAmpListPostRender(ampList);

    if (ampList.is("#childProdsList")) {
      this.pwa.session.lastChildId = ampList
        .find(".cProdCardList")
        .last()
        .attr("id");
      // TODO: put classes on cProdShowMore when PDPV21 is done, didnt want to create a snippet just for this
      if (this.pwa.session.isPdpV21) {
        ampList.find("#cProdShowMore").addClass("t4 d3");
      }
    }
    if (this.pwa.session.isPdpV21 && ampList.is(".cProdCardList")) {
      // remove first border of accessory/collection pp-2560
      ampList
        .closest("#childProdsList")
        .find(".cProdCardList")
        .eq(0)
        .find(".cProdCard")
        .removeClass("dskBorderTop");
    }

    if (
      this.pwa.session.lastChildId &&
      ampList.is(`#${this.pwa.session.lastChildId}`)
    ) {
      delete this.pwa.session.lastChildId;

      // User added to cart on Amp Google CDN on a collection page
      this.pwa.pdp.collectionAmpToPwa(ampList);

      let pWrap$ = ampList.closest(".cProdsWrap");
      let ht = pWrap$.height();
      try {
        let minHt = parseInt((pWrap$.css("maxHeight") || "").replace("px", ""));
        if (minHt && ht < minHt) {
          ampList
            .closest("#childProdsList")
            .find("#cProdShowMore")
            .attr("hidden", "true");
        }
        this.pwa.session.ampStateUnstable = false;
      } catch (e) {
        console.warn(`Unable to parse list height. Error: ${e}`);
      }
    }

    if (ampList.is("#qnaModalListMain") && !ampListElem.io) {
      ampListElem.io = new IntersectionObserver(
        (entries) => {
          for (let entry of entries) {
            if (entry.intersectionRatio == 1) {
              $(entry.target).trigger("click");
            }
          }
        },
        {
          root: $("#qaMain")[0],
          rootMargin: "0px 0px 100% 0px",
          threshold: 1,
        }
      );
      ampList.find("#qaLoadMore").each((i, prodName) => {
        ampListElem.io.observe(prodName);
      });
      return;
    }

    if (ampList.is("#csModalList")) {
      if (this.pwa.util.isDesktop()) {
        let leaveNodes = ampList.find("[data-interact]");
        const handleAction = this.pwa.site.handleAmpAction.bind(this.pwa, 1024);
        leaveNodes.each(function () {
          let eType = $(this).attr("data-interact");
          if (eType) this.addEventListener(eType, handleAction);
        });
      }
      this.pwa.college.ampListPostRenderCollege(ampList);
      return;
    }

    //fix height of storefilter modal in plp & plpv2 & height of amplist in plp
    if (ampList.is("#plpBopisSddList")) {
      if (
        ampList.closest("body").is(".plp") &&
        ampList.find(".pickUpDisabled").length
      ) {
        ampList.addClass("plpBopisSddListExt");
      }
      if (ampList.find(".pickUpDisabled").length) {
        ampList.closest("body").find(".storeFilter").addClass("storeFilterExt");
      } else {
        ampList
          .closest("body")
          .find(".storeFilter")
          .removeClass("storeFilterExt");
      }
      this.pwa.college.ampListPostRenderCollege(ampList);
      return;
    }

    if (ampList.is("#plpPills")) {
      this.pwa.site.socialAnnexPosition();
      let changeStore = await this.pwa.amp.ampGetState("changeStore");
      if (changeStore.storeOnly) {
        ampList.find(".plpBopisPill").removeClass("hide");
      }
      if (changeStore.sddActive) {
        ampList.find(".plpSddPill").removeClass("hide");
      }
      return;
    }

    if (
      ampList.is("#prodPhotoSkuSelUpdate") &&
      !ampList.closest("body").hasClass("quickView")
    ) {
      this.pwa.desktop.addProdSlideNumb(ampList, 5);
      return;
    }

    if (ampList.is("#searchSuggestions")) {
      return this.pwa.sayt.topProductsRender(ampList);
    }

    if (ampList.is(".prodFulfillmentList, .prodFulfillmentList2")) {
      let ampBody$ = ampList.closest("body");
      this.pwa.site.showHideKlarna(ampBody$);

      // When the modal opens amp-state is updated and a bind cycle occurs, which can cause the viewProduct beacon to fire again. It should only fire on initial page load and sku selection.
      // This adds do_not_use flag to viewProduct beacon whent he cart modal opens so that GroupBy knows to ignore the extraneous beacon fire.
      const isAtcModalOpen = !!$("body #modalCartWrap").length;
      this.pwa.site.toggleBeaconDisabledFlag(
        "#groupByViewProduct script",
        isAtcModalOpen ? "disable" : "enable"
      );

      // hide the section that has the add to shoppinglist and add to registry ctas if it will be empty
      // is only empty on harmon at the moment
      if (this.pwa.session.isHARMON) {
        let shoppingListCont = ampList.find(".shopListBtn").parent();
        if (
          !this.pwa.session.features.pdpShoppingList &&
          !this.pwa.session.features.siteRegistry
        ) {
          ampList.height(ampList.height() - shoppingListCont.height());
          shoppingListCont.addClass("wHide");
        }
      }

      setGoogRetailSearchAttributionToken("#groupByViewProduct script");
      try {
        this.pwa.pdp.updateStructuredData();
      } catch (e) {
        console.log(e);
      }
    }

    function setGoogRetailSearchAttributionToken(ampAnalyticsSelector) {
      const { googRetailSearchAttributionToken } = window.sessionStorage;

      try {
        let ampBody$ = ampList.closest("body");
        const gbScript = JSON.parse(ampBody$.find(ampAnalyticsSelector).text());
        if (googRetailSearchAttributionToken) {
          gbScript.extraUrlParams.searchAttributionToken =
            googRetailSearchAttributionToken;
          gbScript.extraUrlParams.experiments[0].experimentVariant = "google";
        } else {
          delete gbScript.extraUrlParams.searchAttributionToken;
          gbScript.extraUrlParams.experiments[0].experimentVariant = "groupby";
        }
        ampBody$.find(ampAnalyticsSelector).text(JSON.stringify(gbScript));
      } catch (err) {
        console.error(err);
      }
    }
    /* Persist location state whenever storeId or sddZipcode change */
    if (ampList.is("#csBannerList")) {
      // do not run on page load, only after user interaction.
      if (this.pwa.session.ampStateUnstable) return;

      let [changeStore, storeInfo] = await Promise.all([
        this.ampGetState("changeStore"),
        this.ampGetState("storeInfo"),
      ]);

      if (!storeInfo) return;

      // Synchronize latLngCookie and SDDCZ cookies
      if (window.wmLocationSync) window.wmLocationSync(false, storeInfo);

      // synchronize bopis and sdd store preferences to match getDefaultStoreByLatLong results
      if (!changeStore) return;
      // bopis
      try {
        let bopisStoreId = storeInfo.data.store.storeId;
        if (changeStore.storeId !== bopisStoreId) {
          this.ampsSetState({ changeStore: { storeId: bopisStoreId } });
        }
      } catch (e) {}
      // sdd
      try {
        let sddStoreId = storeInfo.data.sddData.storeIds[0];
        if (changeStore.sddStoreId !== sddStoreId) {
          this.ampsSetState({ changeStore: { sddStoreId: sddStoreId } });
        }
      } catch (e) {}

      await this.ampStoreAmpStates();

      return;
    }

    /*** PLP mods ***/
    // Update URL if the facet filters have been
    // modified by unchecking a facet or closing a facet filter pill
    const session = this.pwa.session;
    if (ampList.is("#resultsCountList")) {
      if (session.pendingProdListHistoryUpdate == true) {
        let newURL = await this.pwa.site.getFacetURL();

        // XXX MCM + JW TODO, update this to use this.pwa.historyPush()
        history.pushState("", document.title, newURL);

        this.pwa.site.redirectUrlSet();

        delete session.pendingProdListHistoryUpdate;
      }

      let prodList = await this.pwa.amp.ampGetState("prodList");

      // if search page update CBCC elements on page when filters change
      if (this.pwa.session.docTests.isSearchReg.test(location.pathname))
        this.pwa.modifyCbccSearch(ampList, prodList);

      // see if this is a search where we should redirect
      if (prodList && prodList.fusion && prodList.fusion.redirect) {
        this.pwa.load(prodList.fusion.redirect[0]);
      }

      // if there are no results, add noResults class to wmContent manually
      if (prodList && prodList.response && prodList.response.numFound == 0)
        ampList.closest("#wm_content").addClass("noResults");

      // On desktop over 48 products, AMP framework gets maxed out and
      // "forgets" to evaluate .resultCount [text] binding
      // Temp fix until we can get amp friendly composite listing API
      let apiUrl = await this.ampGetState("apiUrl");
      if (apiUrl.perPage > 24)
        ampList
          .find(".resultCount")
          .text(
            ` Showing ${prodList.response.start || 1} - ${
              (prodList.response.start / apiUrl.perPage + 1) * apiUrl.perPage <
              prodList.response.numFound
                ? (prodList.response.start / apiUrl.perPage + 1) *
                  apiUrl.perPage
                : prodList.response.numFound.toLocaleString()
            } of ${prodList.response.numFound.toLocaleString()} products`
          );

      return;
    }

    // Show prod alt image on hover
    // Main PLP cards list
    if (ampList.is("#plpListInner")) {
      const prodImgs = ampList.find(".prodImg amp-img:not(.altImg)");
      const altImgs = ampList.find(".prodImg .altImg");

      if (this.pwa.desktop.isDesktop) {
        prodImgs.each((i, img) => {
          let img$ = $(img);
          let imgWrap$ = img$.closest(".prodCardL");
          const prodId = img$.attr("data-prod-id");

          // v1 - show alt-img
          const altImg = Array.from(altImgs).filter(
            (x) => x.getAttribute("data-prod-id") == prodId
          )[0];
          if (altImg) {
            // v1 - show alt-img
            imgWrap$[0].addEventListener(
              "mouseenter",
              function (img, e) {
                img.classList.add("hide");
                // if (!imgWrap$.find(".btnQuickView").length) {
                //   imgWrap$.append(this.pwa.quickView.quickViewBtn);
                //   imgWrap$
                //     .find(".btnQuickView")
                //     .on(
                //       "mousedown",
                //       this.pwa.quickView.quickViewOpen.bind(this)
                //     );
                // Main PLP cards list
                // }
              }.bind(this, img)
            );
            imgWrap$[0].addEventListener("mouseleave", (e) => {
              img.classList.remove("hide");
              // $(img).closest(".prodCardL").find(".btnQuickView").remove();
            });
          } else {
            // V2 - change img src
            imgWrap$[0].addEventListener(
              "mouseenter",
              function (e) {
                const imgWrap$ = $(e.currentTarget);
                const img$ = imgWrap$.find(".prodCardImg, amp-img").eq(0);
                let altImgSrcId = img$.attr("data-alt-img-src-id");
                if (altImgSrcId)
                  img$.find("img").attr(
                    "srcset",
                    `
                    https://b3h2.scene7.com/is/image/BedBathandBeyond/${altImgSrcId}?$imagePLP$&wid=177&hei=177 177w,
                    https://b3h2.scene7.com/is/image/BedBathandBeyond/${altImgSrcId}?$imagePLP$&wid=236&hei=236 236w,
                    https://b3h2.scene7.com/is/image/BedBathandBeyond/${altImgSrcId}?$imagePLP$&wid=363&hei=363 363w
                    `
                  );
                // if (
                //   imgWrap$.attr("data-type") != "COLLECTION" &&
                //   !imgWrap$.find(".btnQuickView").length
                // ) {
                //   imgWrap$.append(this.pwa.quickView.quickViewBtn);
                //   imgWrap$
                //     .find(".btnQuickView")
                //     .on(
                //       "mousedown",
                //       this.pwa.quickView.quickViewOpen.bind(this)
                //     );
                // }
              }.bind(this)
            );
            imgWrap$[0].addEventListener("mouseleave", (e) => {
              const imgWrap$ = $(e.currentTarget);
              const img$ = imgWrap$.find(".prodCardImg, amp-img").eq(0);
              let imgSrcId = img$.attr("data-img-src-id");
              if (imgSrcId)
                img$.find("img").attr(
                  "srcset",
                  `
                    https://b3h2.scene7.com/is/image/BedBathandBeyond/${imgSrcId}?$imagePLP$&wid=177&hei=177 177w,
                    https://b3h2.scene7.com/is/image/BedBathandBeyond/${imgSrcId}?$imagePLP$&wid=236&hei=236 236w,
                    https://b3h2.scene7.com/is/image/BedBathandBeyond/${imgSrcId}?$imagePLP$&wid=363&hei=363 363w
                    `
                );
              // imgWrap$.find(".btnQuickView").remove();
            });
          }
        });
      }

      setGoogRetailSearchAttributionToken("#groupByAMPAnalytics script");

      // Move Social Annex after PLP render
      this.pwa.site.tealiumPlpCardEvents(ampList);
      this.plpSameDayDeliveryListUpdate(ampList);
      this.pwa.site.socialAnnexPosition();
      // fluid-height ad resizing requires Social Annex repositioning.
      ampList.find("amp-ad").each((i, elem) => {
        this.pwa.util.elemAttrEvent(
          elem,
          "style",
          this.pwa.site.socialAnnexPosition.bind(this)
        );
      });

      // 10.11.21 - Set search PLP robots tag with metaSeoFacetValue value in composit api response instead of based on result count
      // https://bedbathandbeyond.atlassian.net/browse/OR-1056
      let apiUrl = await this.pwa.amp.ampGetState("apiUrl");
      let prodList = await this.pwa.amp.ampGetState("prodList");

      // Googlebot - Remove pagination links if it makes sense to do so
      if (/googlebot/i.test(navigator.userAgent)) {
        // Results fit on one page
        if (results.numFound < apiUrl.perPage) {
          ampList.closest("#wm_content").find("#nextPage, #prevPage").remove();
        }
        // On the last page
        if ((apiUrl.page + 1) * apiUrl.perPage > results.numFound) {
          ampList.closest("#wm_content").find("#nextPage").remove();
        }
        // On the first page
        if (apiUrl.page == 0) {
          ampList.closest("#wm_content").find("#prevPage").remove();
        }
      }

      /*
        This is for scrolling to a specific product card by the prod id
        Used to scroll to plp after hitting the back button from a pdp
        When the pdp was accessed via Google Amp Cache
        PP-818 Amp User journey
      */
      let plpUrl = new URL(location.href);
      const prodIdReg = /prodCard([0-9]+)/;
      if (plpUrl.hash.search(prodIdReg) > -1) {
        let prodIdCard = prodIdReg.exec(plpUrl.hash);
        if (prodIdCard && prodIdCard.length > 1)
          this.pwa.util.plpScrollByProdId(
            prodIdCard[1],
            this.pwa.session.docs.primary.shadowDoc.ampdoc
          );
      }

      // update seo elements of faceted plp
      this.pwa.plp.facetedPlpSeo();

      // Update canonical url on some search pages
      if (prodList.relatedSearches && prodList.relatedSearches.canonicalUrl) {
        $('head link[rel="canonical"]').attr(
          "href",
          location.origin + prodList.relatedSearches.canonicalUrl
        );
      }

      const token = prodList.response.searchAttributionToken;
      if (!token) {
        window.sessionStorage.removeItem("googRetailexperimentId");
        window.sessionStorage.removeItem("googRetailSearchAttributionToken");
      } else {
        // const { googRetailexperimentId, googRetailSearchAttributionToken } =
        //   window.sessionStorage;

        window.sessionStorage.setItem(
          "googRetailexperimentId",
          "s4r_bbby_abtest"
        );

        window.sessionStorage.setItem(
          "googRetailSearchAttributionToken",
          token
        );
      }
      setGoogRetailSearchAttributionToken("#groupByAMPAnalytics script");

      // Allow setState evaluations
      setTimeout(this.pwa.amp.ampsAmpStateIsStableEvt.bind(this), 500);

      // PPS-6291 - part of hotfix 1/25/22, can be removed after 2/2
      // if (!this.pwa.session.features.bopis) {
      //   ampList.find(".inlineflex .txtGreen").parent().remove();
      // }

      if (/type=pickItModal/.test(document.location.search)) {
        this.pwa.pickItModal.scrollPlp(ampList);
      }

      // registryParamRouter sets ctaMenuFlag to add to registry for plp
      if (
        this.pwa.session.features.registryEnable &&
        this.pwa.user.hasRegistry &&
        this.pwa.registry.renderCtaMenuFlag &&
        this.pwa.registry.registryCta.data.data
      ) {
        delete this.pwa.registry.renderCtaMenuFlag;
        let url = new URL(location.href);
        let params = url.searchParams;
        let prodId = params.get("prodId") || "";
        let skuId = params.get("skuId") || "";
        if (/\?/.test(skuId)) {
          // sometimes comes in with extra garbage from react
          skuId = skuId.replace(/\?.*/, "");
        }
        let res$ = ampList.find("[data-prod-reg]").filter((idx, ele) => {
          let regData = JSON.parse($(ele).attr("data-prod-reg"));
          return regData.prodId == prodId && regData.skuId == skuId;
        });
        if (
          this.pwa.registry.registryCta.data.data.registryList &&
          this.pwa.registry.registryCta.data.data.registryList.length > 1
        ) {
          this.pwa.registry.registryCtaMenuRender(res$, true);
        } else if (this.pwa.registry.registryCta.data.data.activeRegistry) {
          this.pwa.registry.registryItemAddedModalRender(
            this.pwa.registry.registryCta.data.data.activeRegistry.registryId,
            res$
          );
        }
      }

      this.pwa.college.ampListPostRenderCollege(ampList);

      return;
    }

    if (ampList.is("#relatedSearchesVisualFacetsList")) {
      ampList.find(".rsLinks").each((ind, item) => {
        let link = $(item);
        if (link.attr("href") == undefined) {
          // href bind expression was not evaluated due to increase in bind expressions
          let linkTxt = link.attr("data-text");
          if (!linkTxt) {
            //hide link as it does not have a valid href
            linkTxt = link.text() || "";
            linkTxt = linkTxt.trim();
            linkTxt = linkTxt.slice(0, linkTxt.lastIndexOf(","));
          }
          if (!linkTxt) link.addClass("hide");
          link.attr(
            "href",
            `${location.origin}/store/s/${encodeURI(
              linkTxt.split(" ").join("-")
            )}?relatedsearch=true`
          );
        }
      });
    }

    // Update img zoom after amplist is rendered
    if (ampList.is("#prodPhotoUpdate")) {
      if (
        ampList.find(".prodSlide").length == 0 &&
        wmPwa.session.docObjActive.hostElem.id == "wmHostPdp"
      ) {
        this.ampsSetState({ random: Math.random() });
      }
      /*
      Rendering zoom images were slowing down LCP as the amp-list is now being renedered on page load.
      The amp-list was only being rendered on user click.
      */
      return;
    }

    if (ampList.is("#searchTitleList")) {
      const [apiUrl, prodList] = await Promise.all([
        this.ampGetState("apiUrl"),
        this.ampGetState("prodList"),
      ]);

      const numFound = prodList.response.numFound;
      if (numFound == 0) {
        ampList.closest("#wm_content").addClass("noResults");
      } else if (numFound > 0) {
        ampList.closest("#wm_content").removeClass("noResults");
      }

      if (
        /\"|\'/gi.test(decodeURIComponent(location.pathname)) &&
        prodList.fusion.q == prodList.fusion.org_q
      ) {
        // nothing was modified, parse from the url
        let reg = /\/store\/s\/([^\/]+)/i;
        let sMatch = reg.exec(location.pathname);
        if (sMatch.length > 1) {
          ampList
            .find(".catTitle")
            .html(
              `&ldquo;${decodeURIComponent(
                sMatch[1].replace(/-/gi, " ")
              )}&rdquo;`
            );
        }
      }

      // AMP chokes when there are too many product cards on the page.
      // temp fix until we get amp-friendly PLP API.
      if (apiUrl.perPage > 24) {
        ampList
          .find(".sCatCt")
          .text(
            numFound === "0"
              ? `NO RESULTS FOR`
              : `${numFound.toLocaleString()} SEARCH RESULT${
                  numFound > 1 ? "S" : ""
                } FOR`
          );
      }

      if (this.pwa.session.docTests.isSearchReg.test(location.pathname)) {
        this.pwa.site.recentSearchDataUpdate();

        // update CBCC elements on page
        this.pwa.modifyCbccSearch(ampList, prodList);
      }

      return;
    }

    if (ampList.is("#prodDeliverZipList")) {
      return this.pdpSameDayDeliveryListUpdate(ampList);
    }

    if (ampList.is("[id^='recommendationsList']")) {
      // listen for intersection on 'You May Also Like' or 'frequenly bought with' intersections and fire tealium pdpCertlikeThisLoveThis or pdpCertYouMayAlsoLike
      // I tried to use the existing prefetchHandlerDelay and other functions, but couldn't batch request, so just starting clean here
      const ampListId = ampList.attr("id");
      const elms = $(ampList).find("[data-prodId][data-Rank]");
      if (elms.length > 0) {
        let observer = new IntersectionObserver(
          function (elms, SELF) {
            elms.forEach((elm) => {
              if (
                elm.isIntersecting &&
                !elm.target.hasAttribute("data-tealiumFired")
              ) {
                //collect elements, add to session array
                if (!wmPwa.pwa.session.recomended) {
                  wmPwa.pwa.session.recomended = {};
                  wmPwa.pwa.session.recomended.type = elm.target.closest(
                    "[id^='recommendationsList']"
                  ).id;
                  wmPwa.pwa.session.recomended.product_displayed = "";
                  wmPwa.pwa.session.recomended.epic_rank = "";
                }

                // mark this one as fired, so we do not call it again
                elm.target.setAttribute("data-tealiumFired", "true");

                // append both the ID and the rank
                wmPwa.pwa.session.recomended.product_displayed +=
                  elm.target.getAttribute("data-prodId") + ",";
                wmPwa.pwa.session.recomended.epic_rank +=
                  elm.target.getAttribute("data-rank") + ",";
              }
            });

            // call tealium
            if (wmPwa.pwa.session.recomended) {
              const sendRecomendedToTealium = wmPwa.util.debounce(function () {
                // make sure we still have something to work with, sometimes the debounce queues up call and this gets called more than once
                if (wmPwa.pwa.session.recomended) {
                  // remove the last comma
                  wmPwa.pwa.session.recomended.product_displayed =
                    wmPwa.pwa.session.recomended.product_displayed.replace(
                      /,\s*$/,
                      ""
                    );
                  wmPwa.pwa.session.recomended.epic_rank =
                    wmPwa.pwa.session.recomended.epic_rank.replace(/,\s*$/, "");

                  // determine which function to call, there is a chance that more than one group will surface here, for now, check the first one
                  if (/LoveThese/.test(wmPwa.pwa.session.recomended.type)) {
                    delete wmPwa.pwa.session.recomended.type;
                    try {
                      pdpCertlikeThisLoveThis(wmPwa.pwa.session.recomended);
                    } catch (e) {}
                  } else {
                    delete wmPwa.pwa.session.recomended.type;
                    try {
                      pdpCertYouMayAlsoLike(wmPwa.pwa.session.recomended);
                    } catch (e) {}
                  }
                }
                // clean up
                delete wmPwa.pwa.session.recomended;
              }, 750);
              sendRecomendedToTealium();
            }
          },
          {
            root: null,
            threshold: 0,
          }
        );
        // root: this.pwa.session.docObjActive.hostElem.parentElement,
        elms.each(function (i, elm) {
          observer.observe(elm);
        });

        // do we need to store and clean up these observers?
        // I was thinking we do, but this says otherwise: https://stackoverflow.com/questions/25314352/how-does-object-observe-unobserve-interact-with-garbage-collection
        // this.pwa.session.observers.push(observer);
      }

      //id^="justForYouTemplate

      // PDP - "You May Also Like", "Like this? You'll love these"
      // Renders sliders for desktop
      /* jk 6.28.21 Need to use our classes intead of amp generated classes
      for some reason the amp-sacrifice class was removed.
      */
      // 6.30.21 TODO - remove cardClass after rebuild
      // TODO
      let cardClass = ampList.find(".x-amp-sacrifice").length
        ? "x-amp-sacrifice"
        : "amp-sacrifice";
      this.pwa.paginatedSlider.init(ampList, {
        cardClass: cardClass,
      });
      return;
    }
    // Home Page, PLP, PDP
    if (
      ampList.is(
        "#justForYouList, #prodYouMightLikeList, #recentlyViewedList, #trendingProductsList, #relatedCatsList, .recommendationsList"
      )
    ) {
      // 6.30.21 TODO - remove cardClass after rebuild
      // TODO
      let cardClass = ampList.find(".x-amp-sacrifice").length
        ? "x-amp-sacrifice"
        : "amp-sacrifice";
      return this.pwa.paginatedSlider.init(ampList, {
        cardClass: cardClass,
      });
    }
    // Review gallery sliders
    if (ampList.is("#reviewOverviewPhotos, #reviewOverviewThumbs")) {
      // 6.30.21 TODO - remove cardClass after rebuild
      // TODO
      let cardClass = ampList.find(".x-amp-sacrifice").length
        ? "x-amp-sacrifice"
        : "amp-sacrifice";
      return this.pwa.paginatedSlider.init(ampList, {
        cardClass: cardClass,
        cardsVisible: 6,
      });
    }
    if (ampList.is(".modProdCarousel")) {
      // 6.30.21 TODO - remove cardClass after rebuild
      // TODO
      let cardClass = ampList.find(".x-amp-sacrifice").length
        ? "x-amp-sacrifice"
        : "amp-sacrifice";
      const isV5 = ampList.closest(".modProductCarousel").hasClass("viewV5");
      return this.pwa.paginatedSlider.init(ampList, {
        cardClass: "amp-sacrifice",
        cardsVisible: isV5 ? 4 : 6,
      });
    }

    this.pwa.college.ampListPostRenderCollege(ampList);

    await this.pwa.personalize.ampListPostRenderPersonalize(ampList);

    /*** User mods ***/
    isHandled = await this.pwa.user.ampListPostRenderUser(ampList);
    if (isHandled) return;

    /*** PDP mods ***/
    isHandled = await this.pwa.pdp.ampListPostRenderPdp(ampList);
    if (isHandled) return;
  }

  /**
   * Fetches urlObj.href and loads amp document in the ampDocObj.hostElem host container
   *
   * @param {Object} ampDocObj - object with document and document host references
   * @param {URL} urlObj - url to fetch
   * @returns {Promise} -
   *    Promise that resolves when document is loaded.
   *    amp.load-catch logic is the same as mo.load-catch logic,
   *    so it is handled in parent pwa.load-catch block
   */
  async ampLoad(ampDocObj, urlObj) {
    let session = this.pwa.session,
      pdpSkuId = null;

    // 1. Strip dev flags from urlObj
    const forcePwa = urlObj.searchParams.get("wmPwa");
    urlObj.searchParams.delete("wmPwa");
    urlObj.searchParams.delete("web3feo");
    urlObj.searchParams.delete("AppShellId");
    urlObj.searchParams.delete("wmDebug");

    // 2. strip facet data from URLs for PLPs:
    const isPlpReg =
      session.docTests.isPLPReg &&
      session.docTests.isPLPReg.test(urlObj.pathname);
    const isBrandReg =
      session.docTests.isBrandReg &&
      session.docTests.isBrandReg.test(urlObj.pathname);
    if (
      (isPlpReg || isBrandReg) &&
      !this.pwa.session.docTests.isCLPReg.test(urlObj.pathname)
      // && !this.pwa.session.docTests.isBrandReg.test(urlObj.pathname)
    ) {
      // parse URL, see if we have facet data
      session.parsedURL = this.pwa.site.parseURL(urlObj);

      // see if the full URL is different than the base URL
      if (session.parsedURL.basePath != session.parsedURL.fullUrl) {
        // set the URL to just fetch the base page
        urlObj.pathname = session.parsedURL.basePath;
      }
    } else if (
      session.docTests.isPDPReg &&
      session.docTests.isPDPReg.test(urlObj.pathname)
    ) {
      // ensure there is no trailing slash, the if statement is not required, but might be faster because regex is more expensive
      if (urlObj.pathname.endsWith("/")) {
        urlObj.pathname = urlObj.pathname.replace(/\/$/, "");
      }
      if (urlObj.searchParams.has("skuId")) {
        pdpSkuId = urlObj.searchParams.get("skuId");
        urlObj.searchParams.delete("skuId");
      }
    }

    // 3. update recently viewed state
    let recentlyViewed;
    try {
      recentlyViewed = localStorage.getItem("recentlyViewed");
    } catch (e) {}
    if (recentlyViewed)
      this.pwa.util.cookieSet(
        "recentlyViewed",
        encodeURIComponent(recentlyViewed),
        null,
        "/",
        location.hostname.replace(/^.*?\./, ".")
      );

    /* 4. Fetch Search page. If search page is not available,
    ?wmDoNotQueue parameter informs CDN to return /store/s/comforter page for all searches */
    let searchPathname,
      searchReg = session.docTests.isSearchReg;

    // TODO , timeout searchHead redirect
    let searchHead = new Promise((resolve, reject) => resolve());
    if (searchReg && searchReg.test(urlObj.pathname)) {
      searchPathname = urlObj.pathname;
      urlObj.searchParams.set("wmDoNotQueue", 1);
      searchHead = fetch(`${urlObj.origin}${urlObj.pathname}?wmSkipPwa`, {
        method: "HEAD",
      });
    }

    // 5. Get Document
    // only give this 8 seconds to respond
    const timeout =
      this.pwa.session.isPreprod || this.pwa.session.isDebug ? 90000 : 8000;
    const fetchTimeOut = setTimeout(() => {
      this.pwa.loadErrorHandler(
        urlObj.href,
        "AMP URL did not fetch in time",
        true
      );
    }, timeout);
    // mode: no-cors to support prefetching amp document in appshell.
    const ampReq =
      this.pwa.session.docPrefetch ||
      fetch(this.ampUrl(urlObj), {
        method: "GET",
        credentials: "include",
        mode: "no-cors",
      });
    const [searchH, ampResp] = await Promise.all([searchHead, ampReq]);
    clearTimeout(fetchTimeOut);

    /*
      Request from Umesh and Rafeh to stop redirecting brand pages to react.
      Subject: Re: wmSkipPwa getting added to Brand pages
      Discussed with Jerimiah that this is the correct approach
      These brand pages were redirects from a search
      https://www.bedbathandbeyond.com/store/s/souper-cubes
      Redirects to:
      https://www.bedbathandbeyond.com/store/brand/souper-cubes/h093?isRedirect=true
      Additionally
      searching for coffee should redirect to 
      https://www.bedbathandbeyond.com/store/category/kitchen/coffee-tea/coffee/12052
    */
    if (searchH && searchH.redirected)
      throw this.pwa.errorCustom(
        "wompRedirect",
        searchH.url.replace(/wmSkipPwa/gi, "")
      );
    //return await this.pwa.mo.moLoad(ampDocObj, new URL(searchH.url));

    // remove Search page override
    urlObj.searchParams.delete("wmDoNotQueue");

    // 6. Re-attach search or other params we
    // stripped in (1. before fetching AMP page)
    // (search pathname is handled by session.parsedURL)
    if (forcePwa !== null) {
      urlObj.searchParams.set("wmPwa", forcePwa);
      urlObj.searchParams.set("wmDebug", forcePwa);
    }

    // 7. Re-attach facet data
    if (
      session.docTests.isPLPReg &&
      session.docTests.isPLPReg.test(urlObj.pathname) &&
      !session.docTests.isCLPReg.test(urlObj.pathname) &&
      session.parsedURL
    )
      urlObj.pathname = session.parsedURL.fullPath;
    else if (session.docTests.isPDPReg.test(urlObj.pathname) && pdpSkuId)
      urlObj.searchParams.set("skuId", pdpSkuId);
    // 8. Validate amp response
    const ampRespText = await this.ampValidateResponse(ampResp, urlObj);
    this.pwa.session.docPrefetch = null;
    const ampDocFragment = this.ampValidateResponseDoc(ampRespText, urlObj);

    // 9. Modify Document before it is attached to the DOM
    await this.ampBeforeRender(
      ampDocFragment,
      urlObj,
      searchPathname,
      pdpSkuId
    );

    // 9.5 If User is logged in (securityStatus cookie == (2|4)),
    // but is missing dynSessionConfNumberValidity=true cookie
    // then amp-user-info won't return user name. Appshell recognizes this case
    // and prefetches session-confirmation API for users without dynSessionConfNumberValidity=true
    if (this.pwa.session.sessionConfirmationPrefetch) {
      let sessionConfObj = await this.pwa.session.sessionConfirmationPrefetch;
      if (!sessionConfObj.err)
        this.pwa.user.sessionConfirmationHeadersGetOrSet(sessionConfObj);
      delete this.pwa.session.sessionConfirmationPrefetch;
    }

    // 10. Clear ampHost and attach Document
    await this.ampClearDoc(ampDocObj);
    this.ampAttachDoc(ampDocObj, ampDocFragment, urlObj.href);

    // 11. Modify AMP document after Render, add event Listeners.
    // JW 5.24.21 - move to pwa.load to ensure predictible URL and amp-bind behavior
    // await this.ampPostRender(ampDocObj, urlObj);

    // 12. Return new amp document object to pwa.load for History and UI management
    return ampDocObj;
  }

  /**
   * Modify the AMP document after it is attached to the ShadowDOM.
   * Because the AMP framework and the browser paint cycle
   * are now involved, modifying the body in this function
   * is slower than in ampBeforeRender
   *
   * @param {Object} ampDocObj - object with document and document host references
   * @param {URL} urlObj - url to fetch
   * @returns {Promise} - Promise that resolves when ampPostRender logic is finished
   */
  async ampPostRender(ampDocObj, urlObj) {
    const ampBody = ampDocObj.shadowBody;
    const ampBody$ = $(ampBody);

    /*** AMP Event Handler Registration ***/
    // 1a. Register click event hander on ampBody.
    ampBody.addEventListener(
      "click",
      this.pwa.clickBodyHandler.bind(this.pwa, ampDocObj)
    );

    // 1b. Register blur event hander on ampBody.
    ampDocObj.shadowBody.addEventListener(
      "blur",
      this.pwa.blurBodyHandler.bind(this.pwa, ampDocObj),
      true
    );

    // 1c. Register data-x-handler attributes on individual elements that have them.
    this.pwa.dataEventHandlerRegister(ampBody$);

    // 2a. Emit pwaDomAdded events whenever amp-lists update in the amp document.
    // "pwaDomAdded" events can be handled in this.ampListPostRender
    this.ampEventsNewDomEmitterRegistration(ampBody);

    // 3. Register form submit event handlers
    ampBody$
      .find("form")
      .each(this.pwa.formSubmitHandlerRegistration.bind(this.pwa));

    // 4. Register "Scroll To" event handlers
    // Multiple documents means that window.scroll functionality doesn't work out of the box.
    this.ampScrollToHandlersRegister(ampBody);

    // 5. register intersection handler for amp document prefetch links found in ampBody
    this.pwa.intersectHandlersRegister(
      "wmPrefetch",
      ampBody,
      "a[data-prefetch]",
      this.pwa.prefetch.prefetchHandlerDelay
    );

    // 6. register intersection handler for amp document prefetch links found in amp-list
    this.pwa.intersectHandlersRegister(
      "wmNudge",
      ampBody,
      "amp-img:not(.i-amphtml-layout), amp-youtube:not(.i-amphtml-layout)",
      this.ampImgLoadCheck
    );

    // 7. Listen for scroll to top btn.
    // this.pwa.intersectHandlersRegister(
    //   "scrollTop",
    //   ampBody,
    //   "#scrollToTopObserver",
    //   async (pwa, intersectionEntry) => {
    //     const trigger = $(intersectionEntry.target);
    //     const scrollTopBtn = trigger.closest("body").find("#scrollToTopButton");
    //     scrollTopBtn.toggleClass(
    //       "active",
    //       intersectionEntry.intersectionRatio != 1
    //     );
    //   }
    // );

    //8. Listen for pencil banner close, leaving viewport events
    //this.pwa.pencilBanner.ampPostRender(ampBody$);
    // Moved this call lower in post render to see if that helps

    // 9. listen for custom amp validation input events
    this.pwa.util.inputsMustMatch(ampBody, "change");
    let docTests = this.pwa.session.docTests;
    let pathAndSearch = `${urlObj.pathname}${urlObj.search}`;

    // This was causing "recently viewed" on PLP to render empty content.
    //10. Intersection for PDP sticky nav
    // if (window.innerWidth >= 768) {
    //   this.pwa.intersectHandlersRegister(
    //     "listNudge",
    //     ampBody,
    //     ".listNudge",
    //     this.pwa.amp.ampListLayoutNudge
    //   );
    // }

    // TEMP fix dev01baby incorrect url
    // How is it being changed from dev01.bbbabyapp to dev01baby.bbbyapp ?
    ampBody$.find("amp-state#navV2Data, amp-state#navV1Data").each((i, e) => {
      const navDataSrc = $(e).attr("src");
      $(e).attr("src", navDataSrc.replace("baby.bbbyapp", ".bbbabyapp"));
    });

    this.pwa.paginatedSlider.init(ampBody$, {
      containerClass: "certonaSliderWrap",
      cardClass: "tealium-product-tile",
      carouselSelector: ".sliderContainer",
      cardsVisible: 5,
    });

    if (window.innerWidth >= 1280) {
      //12. Individual desktop action events (hover events)
      let leaveNodes = ampBody$.find("[data-interact]");
      const handleAction = this.pwa.site.handleAmpAction.bind(this.pwa, 1280);
      let winWidth = ampBody$.outerWidth();
      leaveNodes.each(function () {
        let eType = $(this).attr("data-interact");
        if (eType) this.addEventListener(eType, handleAction);
      });
    }

    this.pwa.desktop.ampPostRenderAll(ampBody$);

    // see if we have sitespect scripts to run
    if (this.pwa.session.runSiteSpect && this.pwa.session.siteSpectScripts) {
      this.pwa.session.siteSpectScripts.each((i) => {
        try {
          // if script, execute it.
          if (this.pwa.session.siteSpectScripts[i].tagName == "SCRIPT") {
            if (this.pwa.session.siteSpectScripts[i].hasAttribute("src")) {
              // script tag with src, append it
              var s = document.createElement("script");
              s.setAttribute("src", this.pwa.session.siteSpectScripts[i].src);
              s.setAttribute("data-sitespect", "true");
              // this function registers an event with window.addEventListener('load'), since this event has already happened, we need to call it after this script loads:
              s.onload = function () {
                // this needs to be called with a setTimeout, not yet sure why, but it does not work without it.
                setTimeout(__preview_history.load, 2000);
              };
              ampBody.appendChild(s);
            } else {
              // execute it by appending it.
              var s = document.createElement("script");
              s.setAttribute("type", "text/javascript");
              s.setAttribute("data-sitespect", "true");
              var code = this.pwa.session.siteSpectScripts[i].innerText;
              try {
                s.appendChild(document.createTextNode(code));
              } catch (e) {
                s.text = code; // set .text for older browsers
              }
              ampBody.appendChild(s);
            }
          } else if (this.pwa.session.siteSpectScripts[i].tagName == "LINK") {
            // create link tag, and append it
            var s = document.createElement("link");
            s.setAttribute("href", this.pwa.session.siteSpectScripts[i].href);
            s.setAttribute("type", "text/css");
            s.setAttribute("data-sitespect", "true");
            s.setAttribute("rel", "stylesheet");
            ampBody.appendChild(s);
          }
        } catch (ex) {
          console.error("Error appending SiteSpect elements. ", ex);
        }
      });
      this.pwa.session.siteSpectScripts = null;
    }

    if (!urlObj.searchParams.has("quickView"))
      this.pwa.pencilBanner.ampPostRender(ampBody$);

    /*** ampPostRender - PLP Specific ***/
    if (docTests.isPLPReg.test(pathAndSearch)) {
      // Prerender pagination links for googlebot
      if (/googlebot/i.test(navigator.userAgent)) {
        const apiUrl = await this.ampGetState("apiUrl", 500);

        const pagePrev =
          apiUrl.page === 0 // First page
            ? null
            : $(
                `<a id="prevPage" rel="prev" aria-label="Previous page" class="g1" href="${
                  urlObj.origin +
                  urlObj.pathname.replace(/\/([0-9]+)\-[0-9]+$/, "")
                }/${apiUrl.page}-${apiUrl.perPage}/">Prev</a>`
              );
        // apiUrl.page is zero-based so add 2 for next page
        const pageNext = $(
          `<a id="nextPage" rel="next" aria-label="Next page" class="g1" href="${
            urlObj.origin + urlObj.pathname.replace(/\/([0-9]+)\-[0-9]+$/, "")
          }/${apiUrl.page + 2}-${apiUrl.perPage}/">Next</a>`
        );

        // Remove amp-list pagination controls and replace with new anchor tags
        const plpPagination = ampBody$.find(".plpPagination");
        plpPagination.find("#plpPagination, #paginationTemplate").remove();
        plpPagination.append(pagePrev, pageNext);
      }
      // Set PLP level state for Tealium Analytics
      ampBody$
        .find(
          ".plpPills, .plpOpts, #facetUpdateList, #dskFacetUpdateList, .plpPagination"
        )
        .on("click", this.pwa.site.tealiumPlpStateManager.bind(this.pwa.site));

      // fluid-height ad resizing requires Social Annex repositioning.
      // ampBody$.find("amp-ad").each((i, elem) => {
      //   this.pwa.util.elemAttrEvent(
      //     elem,
      //     "style",
      //     this.pwa.site.socialAnnexPosition.bind(this)
      //   );
      // });
    }

    // PPS-3603 PWA typeahead issues
    // https://stackoverflow.com/questions/511088/use-javascript-to-place-cursor-at-end-of-text-in-text-input-element
    ampBody$.find("input.searchInput").on("focus", (evt) => {
      setTimeout(
        function () {
          this.selectionStart = this.selectionEnd = 1000;
        }.bind(evt.target),
        0
      );
    });

    this.pwa.plp.ampPostRender(ampBody$);

    this.pwa.college.ampPostRenderCollege(ampBody$, urlObj);

    /*** Desktop Mini Cart hover events */
    if (window.innerWidth >= 768) {
      let cart = ampBody.querySelectorAll("#cartlink");
      let loadCart = this.pwa.appshell.loadCartHover.bind(this);
      cart.forEach((item) => {
        item.addEventListener("mouseenter", loadCart);
      });
    }

    //if this is CLP, listen for social annex intersection, when it is 10px below viewport
    if (!this.pwa.session.isFast) {
      if (
        docTests.isCLPReg.test(pathAndSearch) ||
        docTests.isPLPReg.test(pathAndSearch) ||
        docTests.isHomeReg.test(pathAndSearch) ||
        docTests.isPDPReg.test(pathAndSearch)
      ) {
        let selector = "#socialannex";
        let margin = "0px 0px 10px 0px"; // changed from 1000px to 10px 5/21/21
        if (docTests.isPDPReg.test(pathAndSearch)) {
          selector = "#prodDesc";
          margin = "0px 0px 0px 0px";
        }
        this.pwa.util.runFunctionOnIntersect(
          ampBody$.find(selector),
          margin,
          this.pwa.site.renderSocialAnnex.bind(this.pwa)
        );
      }
    }

    if (docTests.isCLPReg.test(pathAndSearch)) {
      // Check if we need to hide the show more button on seo content
      this.pwa.site.checkSeoHeight(ampBody$);
    }

    /*** AMP Post Render - PDP specific ***/
    this.pwa.pdp.ampPostRenderPdp(ampBody$, urlObj, pathAndSearch);

    // Initializes the account data info
    // JW 9.30.21 - .hasClass("user") until all pages rebuilt
    // with native user support in amp-lists, then we can get rid of this.
    if (window.innerWidth >= 1280 && !ampBody$.hasClass("user")) {
      /* had to change this due to content shift. We will need to test once we start returning
      the appshell to authenticated users. We may see a delay */
      const header = ampBody$.find("#header");
      header.one("mouseenter", this.pwa.desktop.initAcctState.bind(this));
    }

    /*** zipInput exists on PLP and PDP for Shipping/SDD zip code input ***/
    if (!wmPwa.session.isCANADA)
      ampBody$
        .find("#zipInput")
        .on("propertychange input", this.pwa.util.forceNumeric);
    else
      ampBody$
        .find("#zipInput")
        .on("propertychange input", this.pwa.util.fixCaZipcode);

    /* due to PP-1962 and copying cookies, we can not add params to the url parameter */
    // TODO check for cbcc flag
    //if (this.pwa.session.features.siteCbccEnabled) {
    // moved to after render of site mixed banner
    // if (this.pwa.session.isBABY) {
    //   ampBody$
    //     .find("#bbbLogo")
    //     .attr(
    //       "href",
    //       `${location.origin}${
    //         this.pwa.session.apiInfo.sessionRewritePath
    //       }${encodeURI(ampBody$.find("#bbbLogo").attr("href"))}`
    //     );
    // } else if (this.pwa.session.isBBB_US) {
    //   ampBody$
    //     .find("#babyLogo")
    //     .attr(
    //       "href",
    //       `${location.origin}${
    //         this.pwa.session.apiInfo.sessionRewritePath
    //       }${encodeURI(ampBody$.find("#babyLogo").attr("href"))}`
    //     );
    // }
    // // Harmon Logo
    // if (this.pwa.session.isBBB_US || this.pwa.session.isBABY) {
    //   ampBody$
    //     .find("#harmonLogo")
    //     .attr(
    //       "href",
    //       `${location.origin}${
    //         this.pwa.session.apiInfo.sessionRewritePath
    //       }${encodeURI(ampBody$.find("#harmonLogo").attr("href"))}`
    //     );
    // }
    /* PP-1962 was going to change all links in footer but wasn't sure this was correct */
    // moved to site footerPt after render
    // ampBody$
    //   .find("footer")
    //   .find(`a[data-id="social-brand-links"]`)
    //   .each((i, e) => {
    //     let h = $(e).attr("href");
    //     if (!h) return;
    //     if (this.pwa.session.isBABY && /(bedbathandbeyond|bbbyapp)/.test(h)) {
    //       $(e).attr(
    //         "href",
    //         `${location.origin}${
    //           this.pwa.session.apiInfo.sessionRewritePath
    //         }${encodeURI(h)}`
    //       );
    //     } else if (this.pwa.session.isBBB_US && /baby/i.test(h)) {
    //       $(e).attr(
    //         "href",
    //         `${location.origin}${
    //           this.pwa.session.apiInfo.sessionRewritePath
    //         }${encodeURI(h)}`
    //       );
    //     }
    //   });
    //}

    // BounceX is adding its own email signup form into the mod_site_footer. wait for it with intersection observer, then remove it.
    if (!this.pwa.isFast) {
      function removeBounceXFooter() {
        ampBody$.find("#wm_footer > div[id^='bx-campaign']").remove();
      }
      this.pwa.util.runFunctionOnIntersect(
        ampBody$.find("#wm_footer"),
        "1000px 0px 0px 0px",
        removeBounceXFooter
      );
    }

    if (this.pwa.session.features.registryEnable)
      this.pwa.registry.registryAllRender(ampBody$, urlObj);
  }

  /**
   * Register "Scroll To" event handlers
   * Multiple documents means that window.scroll functionality doesn't work out of the box,
   * So we can use this.pwa.scrollIntoView to scroll the various amp documents
   * @param {Element} parentElem - The amp Document to register scrollTo handlers on.
   */
  ampScrollToHandlersRegister(parentElem) {
    $(parentElem.querySelectorAll('[on*="scrollTo"]')).each((i, e) => {
      let btn = $(e);
      let expression = btn.attr("on");
      let scrollToMatch = this.pwa.regExp.scrollTo.exec(expression);
      if (scrollToMatch) {
        let target = `#${scrollToMatch[1]}`;
        btn.on(
          "click",
          this.pwa.scrollToHandler.bind(
            this.pwa,
            parentElem.closest("body"),
            target
          )
        );
      }
    });
  }

  /**
   * Store persistent ampState. Define amp-state Ids to be stored in:
   *  session.amp_sessionStorageIds
   *  session.amp_localStorageIds
   * @param {Object} docObj -
   */
  async ampStoreAmpStates() {
    // Store persistent ampState
    const activeDoc = this.pwa.session.docObjActive.shadowDoc;
    if (!activeDoc) return;

    // Store persistent ampState
    await Promise.all(
      ["sessionStorage", "localStorage"].map(async (storageType) => {
        let storageKey = `amp_${storageType}`;
        // Array of amp-state Ids to persist in local or session storage.
        let storageIds = this.pwa.session[`${storageKey}Ids`];
        if (!storageIds.length) return;

        await Promise.all(
          storageIds.map(async (stateId) => {
            // Don't wait around if the state doesn't exist for a concept. ex: changeStore on Harmon
            let state = await this.ampGetState(stateId, 100);
            if (state == undefined) return;

            this.pwa.session[storageKey] = this.pwa.session[storageKey] || {};
            this.pwa.session[storageKey][stateId] = state;
          })
        );

        try {
          window[storageType].setItem(
            storageKey,
            JSON.stringify(this.pwa.session[storageKey])
          );
        } catch (ex) {
          /* Throws a "QuotaExceededError" DOMException exception
            if the new value couldn't be set. ex:
            iOS private tab, user has disabled storage for the site,
            or the quota has been exceeded */
        }
      })
    );
  }

  /**
   * Returns ampHost CDN href
   * @param {URL} urlObj - canonical url to fetch
   * @returns {String} - ampHost CDN href
   */
  ampUrl(urlObj) {
    return `${this.pwa.session.ampHost}${urlObj.pathname.replace(
      this.pwa.regExp.tmAndReg,
      "-"
    )}${urlObj.search}${urlObj.hash}`;
  }

  /* Same Day delivery PLP List template modification */
  async plpSameDayDeliveryListUpdate(ampList) {
    // 12.4 JW TEMP - overwrite amplist using storeInfo api html fragments
    // to update Same Day delivery messages.
    try {
      const storeInfo = await this.ampGetState("storeInfo");

      // Set time threshold class on parent prod list
      const time = new Date();
      // Tests
      // let cutOff =  '11am';
      // let cutOff =  '12pm';
      // let cutOff =  '4pm';
      let cutOff = storeInfo.data.sddData.displayCutOffTime;
      let am = /am|12pm/i.test(cutOff) ? 0 : 12;
      cutOff = parseInt(cutOff.replace(/\D/gi, ""));
      ampList
        .removeClass("beforeCutOff afterCutOff")
        .addClass(
          time.getHours() < am + cutOff ? "beforeCutOff" : "afterCutOff"
        );

      const afterCutoff = storeInfo.data.sddData.sddAfterCutOffTimeMsg;
      const beforeCutoff = storeInfo.data.sddData.sddBeforeCutOffTimeMsg;
      if (!afterCutoff || !beforeCutoff) return;
      ampList.find(".afterCutOff").html(afterCutoff);
      ampList.find(".beforeCutOff").html(beforeCutoff);
    } catch (ex) {}
  }

  async pdpSameDayDeliveryListUpdate(ampList) {
    try {
      const storeInfo = await this.ampGetState("storeInfo");
      if (storeInfo.errMsg) return;

      const time = new Date();
      const dynamicCutoffMsg =
        time.getHours() < 13
          ? storeInfo.data.sddData.sddBeforeCutOffTimeMsg
          : storeInfo.data.sddData.sddAfterCutOffTimeMsg;
      ampList
        .find('[data-amp-bind-hidden="storeInfo.data.sddData.sddMsgAmp"]')
        .html(dynamicCutoffMsg);
    } catch (e) {
      console.warn(`Error updating SDD delivery message. Error: ${e}`);
    }
  }
}

/**
 *    Analytics
 *      3.30.22 - Most analytics code still scattered throughout PWAMP
 *          as this is a brand new class. Will migrate gradually.
 *
 */
class Analytics {
  constructor(pwa) {
    this.pwa = pwa;
  }

  /**
   * Check if item is Ltl (truck delivery) and call API to get shipping method & description for cart call and tealium ATC and ATRegistry beacons.
   * @param {Object}
   * @param {String} prodId - product id to get LTL data for (PLP)
   * @param {String} skuId - SKU id to get LTL data for (PDP)
   * @returns {Object} {ltlShippingMethod, leve_of_service} or empty object
   */
  async getLtlData({ prodId, skuId }) {
    try {
      await this.pwa.util.waitForProp("pdpDataAbstraction", this.pwa);
      const isPdp = this.pwa.session.docTests.isPDPReg.test(location.pathname);

      const details = isPdp
        ? await this.pwa.pdpDataAbstraction.getSkuDetails()
        : await this.pwa.plp.getPlpItemData(prodId);

      if (details && (details.LTL_FLAG_boolean || details.LTL_FLAG)) {
        const shippingData = await this.pwa.util.statefulFetch(
          `${
            location.origin
          }/apis/stateful/v1.0/cart/shipping/ltl-options?skuId=${
            isPdp ? skuId : details.SKU_ID[0]
          }&locale=en`,
          {
            credentials: "include",
            method: "GET",
            headers: Object.assign(
              {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              await this.pwa.user.sessionConfirmationHeadersGetOrSet()
            ),
          }
        );
        /* Possible LTL ship methods:
            LT : Threshold
            LR : room of Choice
            LW: White Glove Delivery
          */
        return {
          ltlShipMethod: shippingData.data.atgResponse[0].shipMethodId,
          level_of_service:
            shippingData.data.atgResponse[0].shipMethodDescription,
        };
      }
    } catch (e) {
      console.log(
        `analytics.getLtlData error getting the LTL Boolean Flag. Error: ${e}`
      );
    }
    return {};
  }
}

/**
 *    Appshell
 *      appshellBeforeRender() - modify the appshell before page load
 *      appshellPostRender() - modify the appshell after page load
 */
class Appshell {
  /**
   * Appshell specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    // cartModal
    // and headsUpModal
    this.elems = {
      html: $("html"),
      body: $("body"),
      head: $("head"),
      loadingOverlay: $("#wmLoading"),
      modalCartTemplate: $("#modalCartTemplate"),
      modalHeadsUpTemplate: $("#modalHeadsUpTemplate"),
    };

    this.writeReviewHtml = null;
    // if required modal not present, throw error
    for (const [elemKey, elemObj] of Object.entries(this.elems)) {
      if (!elemObj.length)
        console.warn(`Required appshell element ${elemKey} not found.`);
    }

    this.pwa = pwa;
    this.pencilHeight = null;
    this.ampHeaderId = "headerWrap";
    this.pencilObserverId = "pencilObserver";
    this.pencilBannerId = "pencilBanner";
    this.pencilMarkup = null;
    this.cartModalTmp = null;
  }

  /**
   * Modify the appshell before document load
   *
   * @returns {Promise} - Promise that resolves when appshellBeforeRender logic is finished
   */
  async appshellBeforeRender(session) {
    const loadingClass = `${
      session.waitingForPageBuild ? "waiting loading" : "loading"
    }`;
    this.elems.loadingOverlay.addClass(loadingClass);

    this.pwa.pencilBanner.appshellBeforeRender();

    // clean out elements from previous load or 3rd party scripts.
    // preserve social annex stylesheets
    this.elems.head
      .find(
        '*:not([data-wm="appshell"]):not([custom-element]):not([custom-template]):not([href*="socialannex"])'
      )
      .remove();

    // close all modals before loading next amp doc
    await this.closeModalsOnNavigation(this.elems.body);
    // clean up elements from third parties
    this.elems.body.find(".womp-remove").remove();
    this.pwa.session.currentPrice = 0;
  }

  /**
   * Register event handlers on appshell elements.
   * Called one time from pwaStart before any pages are loaded.
   *
   * @returns {Promise} | resolves to undefined;
   */
  async appshellEventHandlersRegister() {
    /* Decorate form and input elements with validity states on blur.
        This allows for CSS-based form feedback.

        Form Input Validation reference
        https://css-tricks.com/form-validation-part-2-constraint-validation-api-javascript/

        Invoked during capturing phase (true) so one handler can handle all blur events.
        This means that blur event listeners placed on a specific element can override this validity decorator.
    */
    // TODO - separate out into subfunction and apply ideaboard input change for ideaboard modal input.
    document.addEventListener("keydown", (event) => {
      /*
        close desktop menu flyouts and return focus for accessibility
        https://bedbathandbeyond.atlassian.net/browse/PPS-6416
      */
      if (event.key == "Escape") {
        let activeDoc = $(this.pwa.session.docObjActive.shadowBody);
        let dskMenu1 = activeDoc.find(".dskNavItem1.active,.navPill.active");
        if (dskMenu1.length > 0) {
          dskMenu1[0].click();
          dskMenu1[0].focus();
        }
      }
    });

    document.addEventListener(
      "blur",
      (event) => {
        const input = event.target;
        const validity = this.pwa.util.formValidateInput(input.validity);
        input.setAttribute("validity", validity);

        const form = $(event.target.form);
        form.addClass("formDirty");
      },
      true
    );

    document.addEventListener(
      "submit",
      async (event) => {
        let target$ = $(event.target);
        let submitHandler = target$.attr("data-submit-handler");

        if (submitHandler) {
          this.pwa.dataEventHandlerParseAndCall(submitHandler, target$, event);
          // for now we are going to just prevent default on all forms that contain the data-submit-handler
          event.preventDefault();
        }
      },
      true
    );

    /*
      PP-818 - when user hits the back button or triggers a back navigation, after visiting a Google amp cache page, they get a 404
      We are checking for the Google Amp Cache url, and if it exists, navigating the user back to the same page in the PWA
    */
    window.addEventListener("beforeunload", (evt) => {
      if (/cdn\.ampproject\.org/gi.test(document.referrer)) {
        // we just navigated from an amp page
        // navigating back returns a 404 so we are going to keep the user in the PWA
        const reg = /cdn\.ampproject\.org\/[v|c]\/s\/(.+)/;
        try {
          const pwaMatch = reg.exec(document.referrer);
          if (pwaMatch.length > 1) {
            let urlObj = new URL(`https://${pwaMatch[1]}`);
            urlObj.pathname = urlObj.pathname.replace("/amp", "");
            if (this.pwa.session.docTests.isPLPReg.test(urlObj.pathname)) {
              let prodId = this.pwa.site.prodIdGet(new URL(location.href));
              urlObj.hash = `prodCard${prodId}`;
              let plpPage = urlObj.searchParams.get("plpPage");
              /*
      PP-818 - when user hits the back button or triggers a back navigation, after visiting a Google amp cache page, they get a 404
      We are checking for the Google Amp Cache url, and if it exists, navigating the user back to the same page in the PWA
    */
              window.addEventListener("beforeunload", (evt) => {
                if (/cdn\.ampproject\.org/gi.test(document.referrer)) {
                  // we just navigated from an amp page
                  // navigating back returns a 404 so we are going to keep the user in the PWA
                  const reg = /cdn\.ampproject\.org\/[v|c]\/s\/(.+)/;
                  try {
                    const pwaMatch = reg.exec(document.referrer);
                    if (pwaMatch.length > 1) {
                      let urlObj = new URL(`https://${pwaMatch[1]}`);
                      urlObj.pathname = urlObj.pathname.replace("/amp", "");
                      if (
                        this.pwa.session.docTests.isPLPReg.test(urlObj.pathname)
                      ) {
                        let prodId = this.pwa.site.prodIdGet(
                          new URL(location.href)
                        );
                        urlObj.hash = `prodCard${prodId}`;
                        let plpPage = urlObj.searchParams.get("plpPage");
                        let perPage = urlObj.searchParams.get("plpPerPage");
                        if (plpPage && perPage) {
                          urlObj.pathname += `/${plpPage}-${[perPage]}`;
                        }
                      }
                      this.pwa.load(urlObj.toString());
                      evt.preventDefault();
                      return (evt.returnValue =
                        "Are you sure you want to return to Google");
                    }
                  } catch (e) {
                    console.log(
                      `Unable to parse google amp cache url. Error: ${e}`
                    );
                  }
                }
              });

              let perPage = urlObj.searchParams.get("plpPerPage");
              if (plpPage && perPage) {
                urlObj.pathname += `/${plpPage}-${[perPage]}`;
              }
            }
            this.pwa.load(urlObj.toString());
            evt.preventDefault();
            return (evt.returnValue =
              "Are you sure you want to return to Google");
          }
        } catch (e) {
          console.log(`Unable to parse google amp cache url. Error: ${e}`);
        }
      }
    });

    const clickBodyHandler = this.pwa.clickBodyHandler.bind(this.pwa);
    document.addEventListener("click", (e) => {
      let target = $(e.target);

      // 11.22.21 Add clickBodyHandler to appShell
      clickBodyHandler(this.pwa.session.docObjActive, e);

      if (target.is(".modalCloseJs")) {
        if (target.hasClass(".modal")) {
          target.remove();
        } else {
          target.closest(".modal").remove();
        }
        /* return focus back to document for accessibility */
        try {
          let activeDoc = this.pwa.session.docObjActive.shadowBody;
          let origin = target.attr("data-origin");
          if (origin) {
            let originNode = $(activeDoc).find(`[data-origin="${origin}"]`);
            if (originNode.length > 0) originNode[0].focus();
          } else if (activeDoc && activeDoc.parentNode) {
            let activeEle = activeDoc.parentNode.activeElement;
            if (activeEle) activeEle.focus();
          }
        } catch (e) {
          console.warn(
            `AppshellEventsHandlerRegister click event. Unable to return focus to amp Doc. Error: ${e}`
          );
        }
      }

      if (target.closest("#cartSliderWrap").length > 0) {
        setTimeout(
          function (currModalCart) {
            currModalCart.remove();
          }.bind(null, $("#modalCartWrap")),
          300
        );
        /**
         * Removed this as it was causing the page to load the pdp page when a user clicked on
         * The add to ideaboard icon in the cart slider
         * Add to ideaboard was being called twice not that the clickBodyHandler has been added to appshell
         */
        // if (/strategy=AddToCart_rr/gi.test(e.target.href)) {
        //   e.preventDefault();
        //   const urlObj = new URL(e.target.href);
        //   urlObj.searchParams.delete("strategy");
        //   this.pwa.load(urlObj.toString());
        // }
      }
      if (target.is(".sliderControl")) {
        this.pwa.paginatedSlider.sliderClick(e);
      }
      if (/type=addIdeaBoard/gi.test(e.target.href)) {
        e.preventDefault();
        // Add to idea board listener for add to idea board links in the appshell
        const params = {};
        const urlObj = new URL(e.target.href);
        for (let [key, value] of urlObj.searchParams.entries()) {
          params[key] = value;
        }
        this.pwa.ideaboard.ideaModalListBoards(
          params,
          "addToIdeaBoard",
          urlObj
        );
      }
      if ($(e.target).is("#closeCartStickyBtn")) {
        this.pwa.appshell.closeCartSticky();
      }

      // may need to put in a check if it was already handled by ampBody
      this.pwa.util.scrollToggle(this.pwa.session.docObjActive, target);
    });
  }

  /**
   * Modify the appshell after document load
   * This is fired after every AMP document is loaded.
   * For functions that only need to fire once after appshell is loaded, put in loadFirstPagePostRender
   * @param {Object} session - pwa session configuration object
   * @param {Object} docObjNext - recently loaded document object
   * @returns {Promise} - Promise that resolves when appshellPostRender logic is finished
   */
  async appshellPostRender(session, docObjNext) {
    if (session.pageLoad == 1) $("#wmSplash").remove();

    const loadingClass = `${
      session.waitingForPageBuild ? "waiting loading" : "loading"
    }`;
    // If Staging session was waiting for amp page to build. Disable staging "waiting" message.
    session.waitingForPageBuild = false;
    this.elems.loadingOverlay.removeClass(loadingClass);

    let body = $("body");
    if (docObjNext.hostElem.id == "wmHostPdp") body.addClass("pdpActive");
    else body.removeClass("pdpActive");
  }

  /**
   * Render Add to Cart Results Modal in the appshell
   * @param {Object} cartObj - response object from /apis/stateful/v1.0/cart/item submission
   */
  async modalCartRender(cartObj, cartSliderFetches) {
    /*
      Commenting out the below as it was part of amp-user journey and we need to call
      from ampList post render. We can't get the scroll from a tile until this list has rendered
    */
    // if (this.pwa.session.docTests.isPLPReg.test(location.pathname))
    //   this.pwa.site.setPlpPositionFromAmp(document, cartObj);

    const showCartModal = async (cartObj) => {
      await this.pwa.util.waitForProp("Mustache");
      if (cartObj.itemQuantity) {
        cartObj.qtySelector = this.pwa.cart.createQtyObj(cartObj.itemQuantity);
        cartObj.qtyOverTen = cartObj.itemQuantity >= 10;
      }

      let modalCartTemplate = "";
      Array.from(this.elems.modalCartTemplate[0].content.children).forEach(
        (child) => (modalCartTemplate += child.outerHTML)
      );

      let modalCart = Mustache.render(modalCartTemplate, cartObj);
      this.pwa.appshell.elems.loadingOverlay.removeClass("loading");
      $("#modalCartWrap").remove();
      this.elems.body[0].insertAdjacentHTML("beforeend", modalCart);
      try {
        let errMsg =
          cartObj.errorMessages &&
          cartObj.errorMessages[0] &&
          cartObj.errorMessages[0].code;
        if (!errMsg && !cartObj.isMultiSku && cartSliderFetches) {
          // Add to cart was successful, show recommendation sliders.
          this.loadCartModalSlider(
            cartSliderFetches,
            $(`#modalCartWrap .modalCart`)
          );
        }
        $("#modalCartWrap .modalCloseJs")[0].focus();
      } catch (e) {
        console.warn(`Error getting product Id. Error: ${e}`);
      }
    };

    // check for heads up modal and remove it
    try {
      $("#modalHeadsUpWrap").remove();
      $("#modalCartWrap .modalContent")[0].focus();
    } catch (err) {}

    /*
    Error codes for Post atc OOS modal:
      ECB03182
      ECB03532
      ECB03215
      ECB01423
      ECB00404
    */
    if (
      cartObj.errorMessages &&
      cartObj.errorMessages.length > 0 &&
      /ECB03182|ECB03532|ECB03215|ECB01423|ECB00404/.test(
        cartObj.errorMessages[0].code
      ) &&
      !cartObj.isMultiSku &&
      this.pwa.session.features.cartRecommendationModal &&
      !this.pwa.session.isHARMON
    ) {
      /*
        I  asked for specific error codes that we should display this modal on. I was told we need to show for all.
        Error codes explained in comment in this ticket
        https://bedbathandbeyond.atlassian.net/browse/PP-3037?focusedCommentId=1079963

        If successfull, stop execution of the rest of the cart modal.

      */
      cartObj.cartError = true;
      if (await this.pwa.pickItModal.render(true, cartObj, cartSliderFetches))
        return;
    }
    showCartModal(cartObj);

    // determine page type
    let currentPageType = this.pwa.session.docTests.isPLPReg.test(
      location.pathname
    )
      ? "plp"
      : "pdp";

    const groupByJson = {
      customerArea: "~~groupByCustomerArea~~",
      product: {
        productId: "~~groupBySiteId~~{{PRODUCT_ID}}",
        title: "{{{DISPLAY_NAME}}}",
        collection: "~~groupByCollection~~",

        // {{#display_LOW_PRICE}}
        // ,"price": "{{.}}"
        // {{/display_LOW_PRICE}}

        // {{^display_LOW_PRICE}}
        // ,"price": "~~groupByPrice~~"
        // {{/display_LOW_PRICE}}

        // {{#SKU_ID}}
        // ,"sku": "{{.}}"
        // {{/SKU_ID}}
      },
      experiments: [
        {
          experimentId: "s4r_bbby_abtest",
          experimentVariant: "groupby",
        },
      ],
    };

    this.pwa.site.tealiumClickEventEmitter(
      $(
        `<div data-cta='${currentPageType}CartAddModal' data-attribute='${groupByJson}'></div>`
      )[0],
      cartObj
    );

    this.sendCartLoadEvent(cartObj);
  }

  async cartErrorModal(cartObj, cartSliderFetches) {
    /*
      Check if the ampDoc has the elements we need
      if not, we do not render the modal and just continue with add to cart
      Could not backfill as the entire snippet was missing from PLP and it would have required too much code.
    */
    if (
      $(this.pwa.session.docObjActive.shadowBody).find(".cartErrorModal")
        .length == 0
    )
      return false;
    let store = "your selected store ";
    // Do not want the entire method to fail if we can not get a store name
    try {
      const storeData = await this.pwa.amp.ampGetState("storeInfo");
      store = storeData.data.store.commonName;
    } catch (e) {}
    try {
      let fulfillmentType = cartObj.isPickIt
        ? `pickup at ${store}`
        : cartObj.isDeliverIt
        ? "same day delivery"
        : "standard shipping";
      const modalTitle = `It looks like this item is no longer available for ${fulfillmentType}, but you can still pick it up in store!`;
      let storeFinderObj = {
        u: {
          storePickupModal: "active",
          fulfillment: fulfillmentType,
          changeStoreLocToggle: true,
          storePickupModalTitle: modalTitle,
          cartError: true,
        },
        changeStore: {
          onlyAvailableStores: true,
          radius: 50,
        },
      };
      if (this.pwa.session.docTests.isPDPReg.test(location.pathname)) {
        const skuDet = await this.pwa.pdpDataAbstraction.getSkuDetails();
        delete skuDet.data;
        storeFinderObj.u.storePickupModalSkuFacets =
          await this.pwa.amp.ampGetState(`skuFacets${cartObj.prodId}`);
        storeFinderObj.u.storePickupModalSku = skuDet;
      } else if (this.pwa.session.docTests.isPLPReg.test(location.pathname)) {
        const item = await this.pwa.plp.getPlpItemData(cartObj.prodId);
        storeFinderObj.u.storePickupModalSkuFacets = {
          qty: "1",
          skuId: cartObj.cartFormSubmission.addItemResults[0].skuId,
          id: cartObj.prodId,
        };

        if (item) {
          storeFinderObj.u.storePickupModalSku = {
            PRODUCT_IMG_ARRAY: [
              {
                imageId: item.scene7imageID,
                description: item.DISPLAY_NAME,
              },
            ],
            DISPLAY_NAME: item.DISPLAY_NAME,
          };
        }
      }
      this.pwa.appshell.elems.loadingOverlay.removeClass("loading");
      this.pwa.amp.ampsSetState(storeFinderObj);
      this.loadCartModalSlider(
        cartSliderFetches,
        $(window.wmPwa.session.docObjActive.shadowBody).find(
          ".pickItModal .modalContentInner"
        ),
        {
          ctaType: fulfillmentType,
          pagination: false,
          removeFirst: true,
          cta: false,
        }
      );
      return true;
    } catch (e) {
      console.warn(
        `Error getting cart error recommendataion data. Error: ${e}`
      );
      // Recovering from error by resetting data that was just set
      let storeFinderObj = {
        u: {
          storePickupModal: null,
          fulfillment: null,
          storePickupModalSku: null,
          changeStoreLocToggle: false,
          storePickupModalSkuFacets: null,
          storePickupModalTitle: null,
          cartError: false,
        },
        changeStore: {
          radius: 25,
        },
      };
      this.pwa.amp.ampsSetState(storeFinderObj);
    }
    return false;
  }

  /**
   * Render Heads Up Modal in the appshell
   * @param {Object} params - params object for add to cart function
   * @param {Object} storeClosestInStock - pdp amp-state "storeClosestInStock"
   */
  async modalHURender(params, storeClosestInStock) {
    try {
      await this.pwa.util.waitForProp("Mustache");
      let modalHeadsUpTemplate = "";

      Array.from(this.elems.modalHeadsUpTemplate[0].content.children).forEach(
        (child) => (modalHeadsUpTemplate += child.outerHTML)
      );
      let modalHU = Mustache.render(modalHeadsUpTemplate, storeClosestInStock);
      this.elems.body[0].insertAdjacentHTML("beforeend", modalHU);

      $(".modalAddToCartJs").on("click", () => {
        this.pwa.site.cartAdd(params, "pickItUp");
      });
      $(".modalCloseJs").on("click", () => {
        $("#modalHeadsUpWrap").remove();
        $(".wmLoading").removeClass("loading");
      });
    } catch (e) {
      this.pwa.site.cartAdd(params, "pickItUp");
    }
  }

  /**
   * Render Add to Cart Results Modal in the appshell
   * @param {Object} cartObj - response object from /apis/stateful/v1.0/cart/item submission
   */
  async sendCartLoadEvent(cartObj) {
    try {
      let cartForm = cartObj.cartFormSubmission.addItemResults[0];
      let prodId = (cartForm.prodId || "").toString();
      let skuId = (cartForm.skuId || "").toString();

      let dataToPass = {
        call_to_actiontype: "add to cart modal",
        channel: "Modal",
        content_pagetype: "My Account",
        device_fingerprint: "",
        feo_site_indicator: "AMP Pages",
        incognito_mode_indicator: "",
        landingPageUrl: document.location.href, // Current Page URL
        navigation_path: "My Account",
        page_function: "My Account",
        page_name: "add to cart modal",
        page_type: "My Account",
        pagename_breadcrumb: "Add to Cart Flyout",
        product_id: [prodId],
        product_pagetype: "",
        product_sku_id: [skuId],
        search_engine_used: "Solr", // XXX this will probably have to change to GB at some point?
        search_keyword: "",
        search_within_search: "",
        search_words_applied: "",
        session_referrer: "",
        session_referrer_domain: "",
        sheer_id_indicator: "Not Verified",
        site_channel: "mobile", // XXX this will changed depending on device, once we support desktop
        subnavigation_path: "My Account", // this was in the example Mehul sent, but does not seem correct...?
      };

      // these were part of the spec that Mehule provided, but since we are not allowing accessories to be added from parent PDP, I do not think they are supported.

      // product_child_accessory_id: (5)["1010793874", "1010793718", "1017825585", "1012816812", "1013595534"], // Look at logic provided below
      // product_collection_id: "102986", // Look at setParentProductInfo function provided below for logic to derive the value

      if (window.triggerLoadEvent) {
        window.triggerLoadEvent(
          "dataLayer=" + encodeURIComponent(JSON.stringify(dataToPass))
        );
      }

      // Clear the params from the url so if the user refreshes, it does not add to cart again
      let urlObj = new URL(location.href);
      urlObj.searchParams.delete("prodId");
      urlObj.searchParams.delete("skuId");
      urlObj.searchParams.delete("qty");
      urlObj.searchParams.delete("type");
      history.pushState("", document.title, urlObj.toString());
    } catch (e) {
      console.warn(`Unable to send Cart Modal Load Event. Error: ${e}`);
    }
  }

  /**
   * Starts process of loading html for the cart slider and fetching api data
   * @returns {undefined}
   */
  async loadCartModalSlider(cartSliderFetches, container$, options) {
    const opt = Object.assign(
      {
        ctaType: null,
        pagination: true,
        removeFirst: false,
        cta: true,
      },
      options ? options : {}
    );
    try {
      // cartModalTmp only added to cartSliderFetches on first Add to Cart
      const [sliderData, cartModalTmp] = await Promise.all(cartSliderFetches);
      this.cartModalTmp = this.cartModalTmp || cartModalTmp || "";
      sliderData.origin = location.origin;
      sliderData.session = this.pwa.session;
      sliderData.productImageUrl = this.pwa.session.apiInfo.scene7RootUrl;
      sliderData.encodeItem = function () {
        return encodeURIComponent(this);
      };
      // JW 7.5.21 removed. I cannot find a reference to sliderData.teliumData
      // sliderData.teliumData = user.data.tealiumUserData;

      if (!sliderData.products || sliderData.products.length == 0) return;

      // If cart error, we need to change the title
      if (opt.ctaType) {
        sliderData.title = opt.ctaType;
      }

      if (opt.removeFirst) container$.find("#cartSlider").remove();

      container$.append(Mustache.render(this.cartModalTmp, sliderData));
      if (opt.cta)
        container$.find(`.cartSliderBtn`).each(function () {
          if (this.innerText == "Add to Cart") {
            this.setAttribute("data-cta", "addToCartFromATCModalSlider");
          }
        });

      if (opt.pagination)
        this.pwa.paginatedSlider.init(container$.find("#cartSlider"), {
          containerClass: "sliderCont",
          cardClass: "sliderCard",
          carouselSelector: ".sliderWrap",
          scrollContClass: "sliderWrap",
          cardsVisible: 4,
        });

      container$
        .find("#cartSlider .cartSliderBtn")
        .attr("data-cta", "addToCartFromATCModalSlider");
    } catch (e) {
      console.warn(`Error rendering the cart slider markup. Error: ${e}`);
    }
  }

  /**
   * Fetches the Mustache template for the cart slider
   * @param {String} - Path to the template
   * @param {String} - Optional id of subtemplate within the file
   * @returns {String} - Mustache template as a string
   */
  async fetchAppshellTmp(path, id) {
    let template = undefined;
    try {
      const cartRes = await fetch(`${location.origin}/amp/7865/${path}`);
      template = await cartRes.text();
      let tmp$ = $(template);
      if (id && (tmp$.find(`#${id}`).length > 0 || tmp$.attr("id") == id))
        template =
          tmp$.find(`#${id}`).length > 0
            ? tmp$.find(`#${id}`).html()
            : tmp$[0].outerHTML;
    } catch (e) {
      console.warn(`Issue fetching appshell template. Error: ${e}`);
    }
    return template;
  }

  /**
   *
   * @param {Object} prodId - Product ID
   * @returns {Object} - JSON object returns from the API
   */
  async fetchCartSliderData(prodId, ctaType) {
    if (!prodId) return [];
    // defaults
    const def = {
      scheme: "AddToCart_rr",
      currencyCode: "USD",
      country: "US",
      site: this.pwa.session.siteId,
      products: prodId,
      isBrowser: true,
      storeId: 0,
      number: 12,
      web3feo: "abc",
      isGroupby: true,
    };

    // GroupBy visitor ID.
    const gbi_visitorId = this.pwa.util.cookieGet("gbi_visitorId");
    if (gbi_visitorId) def.visitorID = gbi_visitorId;

    // PDP "Collections" child products:
    //   Gather some additional properties for Cart Modal also-bought carousel
    await this.pwa.util.waitForProp("docObjActive", this.pwa.session);
    let [pdpDetails, isAccessory] = await Promise.all([
      this.pwa.amp.ampGetState(`pdpDet${prodId}`, 200),
      this.pwa.amp.ampGetState("isAccessory", 200),
    ]);
    // Some Collection child products also have accessories: PRODUCT_VARIATION == "ACCESSORY"
    // Prioritize accessories in this case
    // https://www.bedbathandbeyond.com/store/product/nestwell-washed-linen-cotton-duvet-cover-set/5544670?amp
    isAccessory = isAccessory == true;
    let isCollection = false;

    if (!pdpDetails.errMsg) {
      // Collection Parent pages have collectionStatus object.
      // Products with PARENT_PROD_INFO are part of a collection
      let prodDetails = pdpDetails.data.PRODUCT_DETAILS;
      /*
            PD-781 Shwetta and Aditya confirmed that we need to call productID and parentProductID with
            the top level product id. I still do not think this is correct but matching React
            Logic is in PREP-9085
            Logic on React is as follows
              if an accessory
    // add site id prefix for groupby's CBCC, also seemed to require context
    if (
      this.pwa.session.features.siteCbccEnabled ||
      this.pwa.session.isPreprod
    ) {
      def.products = `${this.pwa.session.siteId}_${def.products}`;
      def.context = def.products;
    }

                - title is accessory
                - call api with parentProdId if there is one, parentProductId == PRODUCT_ID
              If not an accessory & is part of a collection - could not find a react example that shows in this collection
                - title is "In This Collection"
                - Call the api with just products (no parent product id - this doesn't make sense)
              If not either
                - title is "You might need"
                - api is called with just products=PRODUCT_ID (no parentProductId)
            Noticed that React is sometimes calls the api with a parent product id when it is not pdp-details. This is a data issue
            Example page: https://em02-www.bbbyapp.com/store/product/kitchenaid-artisan-5-qt-stand-mixer/102986
            React

        */
      def.products = prodDetails.PRODUCT_ID;
      try {
        def.parentProductId =
          prodDetails.PARENT_PROD_INFO &&
          prodDetails.PARENT_PROD_INFO[0] &&
          prodDetails.PARENT_PROD_INFO[0].PRODUCT_ID
            ? prodDetails.PARENT_PROD_INFO[0].PRODUCT_ID
            : undefined;
      } catch (e) {
        console.log(`Could not get parentProductId. Error: ${e}`);
      }
      if (!isAccessory && def.parentProductId) isCollection = true;
      if (!def.parentProductId) def.parentProductId = prodDetails.PRODUCT_ID;
      if (!isAccessory && !isCollection) delete def.parentProductId;
    }
    let isBopisOrSdd = false;
    try {
      /*
          I was using the url to determine if sdd or bopis was selected,
          however, CA site does not append the sddZip path to the url like US and Baby
          Not sure if this was intentional.
          Regex we were using /\/(sddZip-|store-)[0-9]+/i.test(location.pathname)
          sdd: /\/sddZip-/i.test(location.pathname)
          bopis: /\/store-/i.test(location.pathname)
        */
      // if (this.pwa.session.docTests.isPLPReg.test(location.pathname)) {
      let changeStore = await this.pwa.amp.ampGetState("changeStore");
      isBopisOrSdd =
        changeStore.storeOnly ||
        changeStore.sddActive ||
        ctaType == "deliverIt" ||
        ctaType == "pickItUp" ||
        /\/(sddZip-|store-)[0-9a-z]+/i.test(location.pathname);
      if (isBopisOrSdd) {
        if (changeStore.sddZipcode) {
          def.sddStore = changeStore.sddStoreId || null;
          def.sddZipCode = changeStore.sddZipcode;
        }
        if (changeStore.storeId) {
          def.bopisStore = changeStore.storeId || null;
          delete def.storeId;
        }
      }
      // }
    } catch (e) {
      console.log(
        `Unable to set sdd store or bopis store. In slider get data. Error: ${e}`
      );
    }

    // add site id prefix for groupby's CBCC, also seemed to require context
    def.products = `${this.pwa.session.siteId}_${def.products}`;
    def.context = def.products;

    // Get recommendations:
    let resData = null;
    try {
      const res = await fetch(
        `${
          this.pwa.session.apiInfo.cartSliderApi
        }?${this.pwa.site.objToQueryStr(def)}`
      );
      resData = await res.json();
    } catch (e) {
      console.warn(`Unable to fetch cart slider api data. Error: ${e}`);
    }

    try {
      // Modify Response by product type
      resData.title = isAccessory
        ? "Accessorize Your Item"
        : isCollection
        ? "In This Collection"
        : "You might need...";

      resData.ctaType = ctaType;

      // https://www.bedbathandbeyond.com/store/product/capri-medallion-bath-accessory-collection/816738?wmPwa#development=1
      // "Collections" child product ATC modal recommendations -
      // Also-bought API response has a "records array > allMeta obj" instead of "products" array.
      if (isCollection || isAccessory) {
        if (!resData.products)
          resData.products = resData.records.map((record) => record.allMeta);
      }

      // Modify CTA buttons
      resData.products.forEach((item) => {
        if (item.SKU_ID.length == 1) {
          if (isBopisOrSdd) {
            // plp pages with bopis or sdd selected
            item.ctaText = ctaType == "pickItUp" ? "Pick It Up" : "Deliver It";
            const bopisSddParam = def.bopisStore
              ? `&storeId=${def.bopisStore}`
              : def.sddStore
              ? `&sddZipCode=${def.sddZipCode}`
              : "";
            item.ctaUrl = `/store${item.SEO_URL}?type=${ctaType}&qty=1&skuId=${item.SKU_ID[0]}&prodId=${item.PRODUCT_ID}${bopisSddParam}`;
          } else {
            // pdp pages
            item.ctaText = "Add to Cart";
            item.ctaUrl = `/store${item.SEO_URL}?type=cart&qty=1&skuId=${item.SKU_ID[0]}&prodId=${item.PRODUCT_ID}`;
          }
        } else {
          item.ctaText = "Choose Options";
          item.ctaUrl = `/store${item.SEO_URL}?strategy=${def.scheme}`;
        }
      });
    } catch (e) {
      console.warn(`Unable to create CTA buttons for cart slider. Error: ${e}`);
    }
    return resData;
  }

  /**
   *
   * @param {String} prodTitle - Title
   * @param {String} prodImgSrc - url for product img
   * @param {String} productId - id for product
   */
  async modalWriteReviewRender(prodTitle, prodImgSrc, productId, type) {
    let reviewModal;
    let reviewModalUrl;
    let siteID;
    // JK Might be good to put this into the extraWompLib
    try {
      reviewModalUrl = `${location.origin}/amp/7865/${this.pwa.session.apiInfo.writeReviewHtml}`;
    } catch (e) {
      console.warn(
        `Unable to get modal html url from session info. Error: ${e}`
      );
      reviewModalUrl = `${location.origin}/amp/7865/writeReview-V6.html`;
    }
    let prodInfo = {
      prodImg: prodImgSrc ? prodImgSrc : null,
      title: prodTitle ? prodTitle : null,
      productId: productId,
      modalId: `${type}Modal`,
      formAction: null,
    };
    try {
      prodInfo.userFirstName = this.pwa.user.ampUserInfo
        ? this.pwa.user.ampUserInfo.data.userFirstName
        : null;
      prodInfo = Object.assign(prodInfo, this.pwa.session.apiInfo[type]);
    } catch (e) {
      console.warn(`Unable to get apiInfo from session. Error: ${e}`);
    }
    prodInfo[type] = true;
    try {
      if (this.writeReviewHtml == null) {
        let modalDoc = await fetch(reviewModalUrl);
        this.writeReviewHtml = await modalDoc.text();
      }
    } catch (e) {
      console.error(`Error fetching writereview modal content. Error: ${e}`);
      return;
    }
    try {
      await this.pwa.util.waitForProp("Mustache");
      reviewModal = Mustache.render(this.writeReviewHtml, prodInfo);
    } catch (e) {
      console.warn(`Error loading Mustache. Error: ${e}`);
    }

    // Check that the there isn't already a modal added to the DOM. We don't want two!
    if (
      $(`#${prodInfo.modalId}`).length == 0 &&
      reviewModal &&
      prodInfo.formAction
    ) {
      this.elems.body[0].insertAdjacentHTML("beforeend", reviewModal);
      // Get form router ready to handle form submission
      const formRouter = this.pwa.site.formSubmitRouter.bind(this.pwa.site);
      // Prepare the form validate function
      const formValidator = this.validateForm.bind(this);
      // Get the form node {CashJSCollection}
      const form = $(`#${prodInfo.modalId}Form`);
      // Call the function to track and update the character counts
      this.updateCharacterCount(form[0].getElementsByClassName("formLimitTxt"));
      // Setup events on the form elements to validate as user interacts with the form
      this.initFormValidation(form[0]);
      // Get the add photos button to handle add events
      const fileBtn = document.getElementById("fileBtn");
      // Add event listener to the file btn
      if (fileBtn)
        fileBtn.addEventListener(
          "change",
          this.pwa.site.handleReviewPhotos,
          false
        );
      // Add an event listener to the parent thumbnail container to listen for events
      $("#reviewThumbContainer").on("click", this.removePhoto);
      // Listen for the main form submit and validate
      form.on("submit", function (e) {
        e.preventDefault();
        let form = $(e.target);
        if (formValidator(e.target)) {
          formRouter(form);
        }
      });
      /*
        Would like to refactor into appshell click body event, but since the id is a param, I can not.
        Probably would be best to move the modal class up to the container but there are several modals within a modal
        and it causes issues with modal never being removed.
      */
      $(".modalCloseJs").on("click", () => $(`#${prodInfo.modalId}`).remove());
    }
  }

  /**
   *
   * @param {HTMLElement} form - vanilla javascript object
   * @returns {Boolean} - checking form validity
   */
  validateForm(form) {
    let valid = true;
    const inp = form.getElementsByClassName("validate");
    const appshell = this;
    for (let i = 0; i < inp.length; i += 1) {
      let tmpValid = this.validateInputs(inp.item(i));
      valid = !tmpValid ? tmpValid : valid;
    }
    return valid;
  }

  /**
   *
   * @param {Event} e - HTML event object
   * @returns {undefined}
   */
  removePhoto(e) {
    let target = e.target;
    if (
      $(target).hasClass("removePhoto") ||
      $(target).closest(".removePhoto").length > 0
    ) {
      // Remove icon was clicked
      $(target).closest(".thumbContainer").remove();
    }
    return;
  }

  /**
   *
   * @param {HTMLElement} item - DOM node
   * @param {Array} classes - array of strings to remove from each element
   */
  clearFormValidity(item, classes) {
    const cls = ["invalid", ...classes];
    cls.forEach((c) => {
      item.classList.remove(c);
    });
  }

  /**
   *
   * @param {HTMLElement} item - HTML Document node
   * @param {String} cls - Class to add
   */
  addFormValidity(item, cls) {
    if (cls !== "valid") {
      item.classList.add("invalid");
    }
    item.classList.add(cls);
  }

  /**
   *
   * @param {HTMLElement} items - Element that will be updated as an inputs value changes
   * @param {Object} options - (optional) Options object to override the default options
   */
  updateCharacterCount(items, options) {
    const def = {
      bindAttribute: "data-bind-cnt-to",
      event: "input",
    };
    const opt = Object.assign(def, options);
    for (let i = 0; i < items.length; i += 1) {
      let bindItem = items.item(i);
      let inputId = bindItem.getAttribute(opt.bindAttribute);
      let input = document.getElementById(inputId);
      try {
        let max = input.getAttribute("max-length");
        input.addEventListener(opt.event, (e) => {
          let cnt = e.target.value.length;
          let txt = `${cnt} of ${max} characters`;
          bindItem.textContent = txt;
        });
      } catch (e) {
        console.warn(`Unable to set character count binding. Error: ${e}`);
      }
    }
  }

  /**
   *
   * @param {HTMLElement} item - Dom form node to check validity and add classes as appropriate
   */
  validateInputs(item) {
    let valid = true;
    let classNode =
      item.type == "radio" && item.parentElement ? item.parentElement : item;
    let types = [];
    for (let key in item.validity) {
      types.push(key);
    }
    this.clearFormValidity(classNode, types);
    types.forEach((key) => {
      if (item.validity[key] == true) {
        this.addFormValidity(classNode, key);
        valid = key !== "valid" ? false : true;
      }
    });
    return valid;
  }

  /**
   *
   * @param {HTMLElement} form - DOM form node
   * @param {Object} opt  - (optional) object to overide default options
   */
  initFormValidation(form, opt) {
    const defEvents = {
      text: { event: "focusout", handler: this.validateInputs.bind(this) },
      email: { event: "focusout", handler: this.validateInputs.bind(this) },
      checkbox: { event: "change", handler: this.validateInputs.bind(this) },
      radio: { event: "change", handler: this.validateInputs.bind(this) },
    };
    const events = Object.assign(defEvents, opt);
    const inputs = form.getElementsByClassName("validate");
    for (let i = 0; i < inputs.length; i += 1) {
      let item = inputs.item(i);
      if (events.hasOwnProperty(item.type)) {
        item.addEventListener(events[item.type].event, (e) => {
          events[item.type].handler(e.target);
        });
      }
    }
  }

  /**
   *
   * @param {Objec} resData - JSON object containing the review form response
   */
  renderReviewFormResponse(resData, reviewForm$) {
    const errContainerId = "reviewErrorContainer";
    const errorNode = $(`#${errContainerId}`);
    if (!resData.HasErrors) {
      // form success, set active class on success modal
      $("#writeReviewSuccessModal").addClass("active");
      reviewForm$.closest(".writeReviewModal").hide();
    } else {
      resData.Errors.forEach((item) => {
        $(errorNode).append(item);
      });
      resData.FormErrors.keys.forEach((item) => {
        // activate the appropriate form errors
        // I don't think BBB is using this. Just returns success
      });
      if (resData.Errors.length > 0) $(errorNode).removeClass("hide");
    }
  }

  /**
   *
   * @returns {Object} data - data from fetch api call to amp-user-info (for pencil banner, cart sticky);
   */
  async getAmpUserInfo() {
    try {
      let ampUserInfo = await this.pwa.amp.ampGetState("user", 500);
      if (ampUserInfo && ampUserInfo.data) return ampUserInfo;
    } catch (e) {
      console.warn(`Unable to get ampUserInfo from amp state. Error: ${e}`);
    }
    let ampUserUrl = `${location.origin}/apis/services/composite/v1.0/amp-user-info`;
    let queryParams = /bbbyapp/gi.test(location.origin)
      ? `web3feo&__amp_source_origin=${encodeURIComponent(location.origin)}`
      : `__amp_source_origin=${encodeURIComponent(location.origin)}`;
    let fullUrl = `${ampUserUrl}?${queryParams}`;
    try {
      const resp = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
        },
        credentials: "include",
      });
      return await resp.json();
    } catch (e) {
      console.warn(`Unable to get amp-user-info. Error: ${e}`);
    }
    return;
  }

  /**
   * Attaches content from a template element to the DOM.
   * If the template was present in the appshell source,
   * any scripts present in the template will also
   * run when the content is appended.
   *
   * @param {String} targetElemSelector -
   *    selector for element that will host the template content
   * @param {String} srcTemplateSelector - Template element selector
   *    (On first document parse, template content is parsed into
   *     a document fragment, but not run or appended to the DOM)
   */
  renderTemplate(targetElemSelector, srcTemplateSelector) {
    const targetElem = document.querySelector(targetElemSelector);
    const srcTemplate = document.querySelector(srcTemplateSelector);

    if (!targetElem || !srcTemplate) {
      this.pwa.errorCustom(
        `${targetElemSelector} dom target or ${srcTemplateSelector} source template not found in appshell.`
      );
    }

    targetElem.innerHTML = "";
    targetElem.append(srcTemplate.content.cloneNode(true));
  }

  /**
   *
   * @param {CachJSNode} shell - body element of the appshell
   */
  async closeModalsOnNavigation(shell) {
    // close appshell modals
    shell.find(".modal").remove();
    // close amp modals

    // remove modalOpen "page freeze class"
    shell.removeClass("modalOpen");

    // if second pageload and amp-state id="u" (modal object) exists, reset it.
    if (this.pwa.session.docObjActive) {
      let u = await this.pwa.amp.ampGetState("u", 0);
      if (!u.errMsg) this.pwa.amp.ampsSetState({ u: null });
    }
    return true;
  }

  /**
   * Download Desktop Templates and add them to session.
   * @returns {String} - HTML templates
   */
  async loadDesktopTemplates() {
    let tmpUrl = "";
    if (
      this.pwa.appshell.hasOwnProperty("desktopTemplates") &&
      this.pwa.appshell.desktopTemplates !== ""
    )
      return;
    try {
      if (this.pwa.session.apiInfo.desktopTemplates) {
        tmpUrl = `${location.origin}/amp/7865/${this.pwa.session.apiInfo.desktopTemplates}`;
      } else {
        tmpUrl = `${location.origin}/amp/7865/desktopTempV3.html`;
      }
    } catch (e) {
      console.warn(
        `Unable to get desktop template url from session info. Error: ${e}`
      );
    }
    try {
      this.pwa.util.scriptAddMustache();
      let tempDoc = await fetch(tmpUrl);
      if (tempDoc.status == 200) {
        this.pwa.appshell.desktopTemplates = await tempDoc.text();
      }
      return true;
    } catch (e) {
      console.warn(`Unable to fetch desktop templates. Error: ${e}`);
      return false;
    }
  }

  /**
   *
   * @param {DOM Event} e - DOM event
   * @returns {Boolean}
   */
  async loadCartHover(e) {
    if (window.innerWidth < 1280) return;
    let cart = $(e.currentTarget).parent();
    let tmp = "";
    let cartHover = "";
    let cartItems = {};
    let cartId = "dskCartHover";

    let tmpDoc;
    function _loadCartError() {
      let cartErrTmp = `<div class="cartOverlay" id="${cartId}">
      <p class="cartError error txtCtr">There was an error loading cart items</p>
    </div>`;
      _insertNode(cartErrTmp);
    }
    function _insertNode(content) {
      if (cart.find(`#${cartId}`).length > 0) {
        cart.find(`#${cartId}`).replaceWith(content);
      } else {
        cart.append(content);
      }
    }
    try {
      if (!this.pwa.appshell.desktopTemplates) {
        await this.pwa.appshell.loadDesktopTemplates();
      }
      await this.pwa.util.waitForProp("Mustache");
    } catch (e) {
      console.warn(`Unable to load Mustache`);
      _loadCartError();
      return false;
    }
    try {
      tmpDoc = $(this.pwa.appshell.desktopTemplates);
      tmp = tmpDoc.find("#cartHoverTmp").html();
      cartHover = Mustache.render(tmp, {});
      _insertNode(cartHover);
      if (!this.pwa.session.miniCartData) {
        this.pwa.session.miniCartData = await this.pwa.appshell.getCartData();
      }
      if (!this.pwa.session.miniCartData.data.hasOwnProperty("emptyMsg")) {
        if (this.pwa.session.isBABY) {
          this.pwa.session.miniCartData.data.emptyMsg =
            "There are no items in the cart";
        } else {
          this.pwa.session.miniCartData.data.emptyMsg =
            "Your shopping cart is empty.";
        }
      }
      // change which badge is applied to img based on site item is from
      this.pwa.session.miniCartData.data.atgResponse.Cart.commerceItemVOList.forEach(
        (i) => {
          if (/BuyBuyBaby/.test(i.siteIdentifier)) {
            i.siteIndicator = "Baby";
          } else if (/BedBathUS/.test(i.siteIdentifier)) {
            i.siteIndicator = "BedBath";
          } else if (/HarmonUS/.test(i.siteIdentifier)) {
            i.siteIndicator = "Harmon";
          }
        }
      );

      cartHover = Mustache.render(tmp, this.pwa.session.miniCartData);
      _insertNode(cartHover);
    } catch (e) {
      console.warn(`Unable to get cart data. Error: ${e}`);
      _loadCartError();
      return false;
    }
  }
  /**
   *
   * @param {Event Object} e - leaving the mini cart
   * @returns {Boolean}
   */
  closeCartHover(e) {
    $(e.target).parent().find("#dskCartHover").remove();
    return true;
  }

  /**
   * @returns {Object} - Object data from current-order api for displaying in mini cart
   */
  async getCartData() {
    // get session
    try {
      let auth = await this.pwa.user.sessionConfirmationHeadersGetOrSet();
      let cartItems = await this.pwa.util.statefulFetch(
        `${location.origin}/apis/stateful/v1.0/cart/current-order-details?type=mini&arg1=true&web3feo`,
        {
          credentials: "include",
          method: "GET",
          headers: Object.assign(auth, {
            "atg-rest-depth": 5,
            ispreview: false,
            accept: "application/json, text/plain, */*",
          }),
        }
      );
      if (cartItems.data) {
        //let cartItems = await cartDoc.json();
        cartItems.origin = location.origin;
        if (cartItems.data.atgResponse.Cart.commerceItemVOList.length > 0) {
          cartItems.data.atgResponse.Cart.commerceItemVOList[0].justAdded = true;
        }
        cartItems.scene7RootUrl = this.pwa.session.apiInfo.scene7RootUrl;
        return cartItems;
      }
    } catch (e) {
      console.warn(`Error getting cart data. Error: ${e}`);
      return {};
    }
  }

  /**
   * Used to udpate the cart data. This can be called without an await for performance
   * @returns {Boolean}
   */
  async updateCartData() {
    this.pwa.session.miniCartData = await this.pwa.appshell.getCartData();
    return true;
  }

  /**
   * @param {Boolean} - if cart is sticky is already rendered. Determins if it animates in or just updates the content
   * @returns {Boolean} - Did the cart sticky render?
   */
  async renderCartSticky() {
    let CloseStickyCheckout;
    try {
      CloseStickyCheckout = window.sessionStorage.CloseStickyCheckout;
    } catch (e) {}
    if (window.innerWidth < 1024 || CloseStickyCheckout) {
      $("#cartSticky").addClass("wHide");
      return false;
    }
    // in case cart sticky is already rendered and was hidden on resize event
    $("#cartSticky").removeClass("wHide");
    const cartStickyId = "cartSticky",
      cartCntId = "cartCnt",
      cartTmpId = "cartDrawerTmp";
    let cartTmp = "";
    function updateCnt(cnt) {
      let cont = $(`#${cartCntId}`);
      if (cont.length > 0) {
        $(`#${cartCntId}`).text(cnt);
        return true;
      }
      return false;
    }
    function insertCartSticky(htmlStr) {
      let sticky = $(`#${cartStickyId}`);
      if (sticky.length > 0) {
        sticky.replaceWith(htmlStr);
      } else {
        $("body").append(htmlStr);
      }
      return true;
    }
    try {
      let cartCnt = "0";
      if (!this.pwa.session.miniCartData) {
        const userInfo = await this.getAmpUserInfo();
        if (userInfo && userInfo.data.Cart)
          cartCnt = userInfo.data.Cart.itemCount;
        //this.pwa.session.miniCartData = await this.pwa.appshell.getCartData();
      } else {
        cartCnt =
          this.pwa.session.miniCartData.data.atgResponse.Cart.cartItemCount;
      }
      if (cartCnt == "0") return false;
      if ($(`#${cartCntId}`).length > 0) {
        // not going to rerender the entire sticky, just going to update cart number
        return updateCnt(cartCnt);
      } else {
        // not rendered therefore we need to get mustache and template
        // this will happen only on first render or as soon as an item is added to cart
        let tmpDoc;
        if (!this.pwa.appshell.desktopTemplates) {
          tmpDoc = (await this.pwa.appshell.loadDesktopTemplates())
            ? $(this.pwa.appshell.desktopTemplates)
            : null;
        } else {
          tmpDoc = $(this.pwa.appshell.desktopTemplates);
        }
        cartTmp = tmpDoc.find(`#${cartTmpId}`).html();
        if (!cartTmp) throw "Error loading desktop templates";
        await this.pwa.util.waitForProp("Mustache");
        const cartRendered = Mustache.render(cartTmp, {
          state: "render sHide tHide",
          count: cartCnt,
        });
        return insertCartSticky(cartRendered);
      }
    } catch (e) {
      console.warn(`Error loading rendering cart sticky. Error: ${e}`);
      return false;
    }
    return false;
  }

  /**
   * @returns {Boolean} - was cart sticky properly closed
   */
  closeCartSticky() {
    $("#cartSticky").remove();
    try {
      window.sessionStorage.CloseStickyCheckout = true;
      this.pwa.util.cookieSet("CloseStickyCheckout", true);
      return true;
    } catch (e) {}
  }

  /**
   *
   * @param {CashJsCollection} ampBody
   */
  addHeaderTagsToAppshell(ampBody) {
    try {
      let selectors = "h1,h2,h3";
      // We don't want header tags from the header section
      let headers = ampBody
        .find(selectors)
        .not("header h1,header h2,header h3,.noResultsTitle")
        .clone();
      if (headers.length > 0) {
        let container = $("body").find(".headerContainer");
        if (container.length > 0) {
          container.html("");
        } else {
          container = $(`<div class="headerContainer wHide"></div>`);
          $("body").append(container);
        }
        // tested performance of clone() against iterating nodes and apppending outerHtml string
        // iterating: ~1.5600
        // clone: ~.44500
        container.append(headers);
      }
    } catch (e) {
      console.warn(`Unable to create SEO headers in appshell. Error: ${e}`);
    }
  }
}

/**
 * Working toward a modular approach to cart
 * Eventually, the site.cartAdd method will be refactored to this class
 * Currently only used for quantity interaction in the cart modal
 * https://bedbathandbeyond.atlassian.net/browse/PP-3223
 * https://app.zeplin.io/project/61f07898052106a68cbffabf/screen/61f3013dd4f8acb5026f833a
 */
class Cart {
  constructor(pwa) {
    this.pwa = pwa;
  }

  /**
   *  Used when a user clicks on an element in the selector
   * @param {String} str - this will probably be empty
   * @param {*} targ$ - current target of quantity click
   */
  async qtyClick(str, targ$) {
    let qty = str;
    let cont$ = targ$.closest(".qtySelectWrap");
    try {
      this.removeQtyAlert(targ$);
      if (qty == "10+") {
        let qtyInp$ = cont$.find("#qtyInput");
        qtyInp$.val(10);
        if (!qtyInp$.attr("data-blur")) {
          qtyInp$.on("blur", (e) => {
            this.tenPlus($(e.target));
          });
          qtyInp$.attr("data-blur", true);
        }
        cont$.find(".qtySelectBtn").addClass("wHide");
        cont$.find(".qtyLabel").removeClass("wHide");
        qtyInp$.removeClass("wHide");
        qtyInp$[0].focus();

        // show input and hide button
      } else {
        if (!this.validateQty(qty)) throw new Error(`Invalid Quantity.`);
        cont$.find("[data-qty-update]").each((i, e) => {
          if ($(e).attr("value")) {
            $(e).val(qty);
          } else {
            $(e).text(qty);
          }
        });
        cont$.find(".active").removeClass("active");
        targ$.addClass("active");
        cont$.removeClass("active");
        const cartObj = await this.submitQtyForm(targ$);
        if (cartObj.errorMessages && cartObj.errorMessages.length > 0)
          throw new Error("Unable to update quantity");
        this.updateCartData(cartObj, targ$);
      }
    } catch (e) {
      this.qtyError(targ$, e.message);
    }
    cont$.removeClass("active");
    return true;
  }

  /**
   * Used to open and close the quantity selector
   * @param {String} str - optional, not used
   * @param {CashJs node} targ$ - target of the click
   * @param {Event} evt
   * @returns
   */
  qtyToggle(str, targ$, evt) {
    evt.preventDefault();
    this.initQtyClick(targ$);
    let parent = targ$.parent();
    if (parent.hasClass("active")) {
      parent.removeClass("active");
    } else {
      parent.addClass("active");
    }
    return true;
  }

  /**
   *
   * @param {CashJs Node} targ$ - click on quantity select
   */
  initQtyClick(targ$) {
    let wrap$ = targ$.closest("#modalCartWrap");
    if (!wrap$.attr("data-qtyClick")) {
      wrap$.on("click", (e) => {
        let targ$ = $(e.target);
        if (targ$.closest(".qtySelectWrap").length == 0) {
          $(".qtySelectWrap").removeClass("active");
        }
      });
      wrap$.attr("data-qtyClick", true);
    }
  }

  /**
   * Handle the situation where a user selects the 10+ option
   * Hides the select and submits the new values
   * @param {CashJs Node} targ$ - item clicked from within the select
   */
  async tenPlus(targ$) {
    let qty = targ$.val();
    try {
      this.removeQtyAlert(targ$);
      if (!this.validateQty(qty)) throw new Error("Invalid quantity");
      targ$.attr("readonly", "readonly");
      const cartObj = await this.submitQtyForm(targ$);
      if (qty < 10) {
        let cont$ = targ$.closest(".qtySelectWrap");
        let btn$ = cont$.find(".qtySelectBtn");
        btn$.find(".cartQtyTxt").text(qty);
        btn$.removeClass("wHide");
        cont$.find("#qtyInput").addClass("wHide");
        cont$.find(".qtyOpt.active").removeClass("active");
        cont$.find(`[data-qty="${qty}"]`).addClass("active");
        cont$.find(".qtyLabel").addClass("wHide");
      }
      this.updateCartData(cartObj, targ$);
    } catch (e) {
      this.qtyError(targ$, e.message);
    }
    targ$.removeAttr("readonly");
  }

  /**
   *
   * @param {CashJs Node} targ$
   * @param {String} error - Error string to add to the DOM
   */
  qtyError(targ$, error) {
    // handle validation errors
    let cont$ = targ$.closest(".modalContent").find("#quantityError");
    cont$.text(error).removeClass("wHide");
  }

  /**
   * Remove any quantity alerts
   * @param {CashJs Node} targ$
   */
  removeQtyAlert(targ$) {
    targ$.closest(".qtyWrap").find(".qtyAlert").remove();
  }

  /**
   * This submits an update to the cart MS for the quantity.
   * I was going to originally just call cartAdd again with the new data, and re-render the modal
   * However, the data returned from the cart MS when you submit a quantity update
   * Is completely different the add to cart call.
   * It would require so much refactoring that I thought it was better to create a new method
   * @param {CashJs Node} targ$ - target of item clicked in the quantity select or the 10+ input
   * @returns
   */
  async submitQtyForm(targ$) {
    let params = {};
    let form$ = targ$.closest("form");
    try {
      if (form$.length == 0) throw new Error("Unable to get qty form");

      params = this.pwa.util.formToObject(form$);
      let postData = "";
      if (params.commerceItemId && params.qty) {
        // this is a cart update
        postData = `updateCartInfoSemiColonSeparated=${encodeURIComponent(
          params.commerceItemId + "=" + params.qty + ";"
        )}`;
      }
      const cartResObj = await this.pwa.util.statefulFetch(
        `${location.origin}/apis/stateful/v1.0/cart/item`,
        {
          body: postData,
          credentials: "include",
          method: "PUT",
          headers: Object.assign(
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );
      if (cartResObj.errorMessages && cartResObj.errorMessages.length > 0)
        throw new Error(
          `Error updating quantity. Error: ${cartResObj.errorMessages[0].message}`
        );
      // sub = await this.pwa.site.formCartHandler(form$);
      this.pwa.session.miniCartData = await this.pwa.appshell.getCartData();
      params = Object.assign(params, this.pwa.session.miniCartData);

      try {
        let cartItmCnt =
          this.pwa.session.miniCartData.data.atgResponse.Cart.cartItemCount;
        this.pwa.amp.ampsSetState({
          user: {
            data: {
              Cart: {
                itemCount: cartItmCnt,
              },
            },
          },
        });
        // Check if cart sticky needs to be rendered
        this.pwa.appshell.renderCartSticky();
      } catch (ex) {
        console.warn("unable to update cart count", ex);
      }
    } catch (e) {
      console.warn(`Cart update error: ${e.message}`);
      throw new Error("There was a problem updating the item quantity");
    }
    return params;
  }

  /**
   * This updates the subtotal and item count after a quantity change
   * @param {Object} cartObj - Data from the cart quantity submission
   * @param {CashJs Node} targ$ - target that was clicked in the select or the 10+ input
   * @returns
   */
  async updateCartData(cartObj, targ$) {
    let modal$ = targ$.closest(".modalContent");
    let cont$ = modal$.find("[data-cartDetails-temp]");
    let cartTemp = this.cartDetTemplate;
    this.removeQtyAlert(targ$);
    let renderObj = {
      freeShippingEligible: false,
      shipThreshhold: 39,
      shipDiff: 0,
      freeShippingPromo: false,
      isShipIt: false,
      formatPrice: function () {
        return this.toFixed(2);
      },
      isMultiSku: false,
      cartItemCount: 1,
      editQty: true,
      scene7Base: this.pwa.session.apiInfo.scene7RootUrl + "/",
      storeName: cartObj.storeName || null,
      sddZip: cartObj.sddZip || null,
    };
    /*
      Need to test multiSku template
      Scrape properties
      itemQuantity


    */
    try {
      await this.pwa.util.waitForProp("Mustache");
      if (!cartTemp) {
        cartTemp = $(
          this.pwa.$$$(
            this.pwa.appshell.elems.modalCartTemplate[0].content,
            "#cartDetailsTemp"
          )
        );
        if (!cartTemp || cartTemp.length == 0)
          throw new Error(
            `Unable to find the shipping tempalte for updating cart subtotal`
          );

        this.cartDetTemplate = cartTemp;
      }
      renderObj.orderPriceInfoDisplayVO = {
        formattedOrderSubTotal:
          cartObj.data.atgResponse.Cart.orderPriceInfoDisplayVO
            .formattedTotalAmount,
      };
      renderObj.cartItemCount =
        cartObj.data.atgResponse.Cart.orderPriceInfoDisplayVO.itemCount;

      ({
        skuId: renderObj.skuId,
        prodId: renderObj.prodId,
        qty: renderObj.itemQuantity,
        commerceItemId: renderObj.commerceItemId,
      } = cartObj);
      let qtyInt = parseInt(cartObj.qty || 1);
      renderObj.qtyOver2 = qtyInt > 1;
      renderObj.commerceItemVOList =
        cartObj.data.atgResponse.Cart.commerceItemVOList.filter(
          (item) => item.skuId == cartObj.skuId
        );
      renderObj.commerceItemVOList[0].scene7URL =
        renderObj.commerceItemVOList[0].skuSmallImage;
      renderObj.qtySelector = this.pwa.cart.createQtyObj(cartObj.itemQuantity);
      renderObj.qtyOverTen = qtyInt >= 10;
      renderObj.isShipIt = cartObj.type == "cart";
      renderObj.isDeliverIt = cartObj.type == "deliverIt";
      renderObj.isPickIt = cartObj.type == "pickItUp";

      if (cartObj.type == "cart") {
        renderObj.isShipIt = true;
        renderObj.shipDiff =
          cartObj.data.atgResponse.ClosenessQualifier.freeShippingBanner.shippingDifference;
        renderObj.freeShippingEligible =
          cartObj.data.atgResponse.ClosenessQualifier.freeShippingBanner.showCongratsFreeShipMsg;
        renderObj.freeShippingPromo =
          cartObj.data.atgResponse.ClosenessQualifier.freeShippingBanner.freeShippingPromo;
      }
      let atcHtml = Mustache.render(cartTemp.eq(0).html(), renderObj);
      cont$.eq(0).html(atcHtml);
      cont$.find("#qtyInput").on("blur", (e) => {
        this.tenPlus($(e.target));
      });
    } catch (e) {
      console.warn(`Unable to update subtotal`);
      this.qtyError(
        targ$,
        "Your quantity was updated but there was a problem updating this modal"
      );
      return false;
    }
    // try {
    //   let priceTemp = [];
    //   /* update price */
    //   if (!this.priceTemp) {
    //     priceTemp = $(
    //       this.pwa.$$$(
    //         this.pwa.appshell.elems.modalCartTemplate[0].content,
    //         "#priceTemp"
    //       )
    //     );
    //     if (priceTemp.length == 0)
    //       throw new Error(`Could not find price template for atc modal`);

    //     this.priceTemp = priceTemp;
    //   }
    //   if (
    //     cartObj.data.atgResponse &&
    //     cartObj.data.component.order &&
    //     cartObj.data.component.order.commerceItemVOList &&
    //     cartObj.data.component.order.commerceItemVOList.length &&
    //     cartObj.data.component.order.commerceItemVOList[0].IS_PRICE
    //   ) {
    //     let renderObj = {
    //       IS_PRICE: cartObj.data.component.order.commerceItemVOList[0].IS_PRICE,
    //       WAS_PRICE:
    //         cartObj.data.component.order.commerceItemVOList[0].WAS_PRICE ||
    //         null,
    //     };
    //     let priceHtml = Mustache.render(priceTemp.eq(0).html(), renderObj);
    //     if (priceHtml) modal$.find("[data-atcPrice-temp]").html(priceHtml);
    //   }
    // } catch (e) {
    //   console.warn(`cart.updateCardData Error: ${e}`);
    // }
    return true;
  }

  /**
   * @param {String} qty - quantity that was entered
   */
  validateQty(qty) {
    let valid = true;
    try {
      let qtyN = parseInt(qty);
      if (qtyN < 1) valid = false;
    } catch (e) {
      valid = false;
    }
    return valid;
  }

  /**
   *
   * @param {String} qty - current quantity that should be selected
   * @returns
   */
  createQtyObj(qty) {
    let obj = [];
    try {
      let qtyN = parseInt(qty);
      for (let i = 0; i < 10; i += 1) {
        let q = i + 1;
        obj.push({
          qtyVal: `${q}`,
          selected: qtyN == q,
        });
      }
      obj[obj.length - 1].qtyVal += "+";
    } catch (e) {
      console.warn(`cart.createQtyObj, Error: ${e}`);
    }
    return obj;
  }
}

/**
 * College Class
 * code specific to College Pod Features
 */
class College {
  constructor(pwa) {
    this.pwa = pwa;
    // this will need to be updated when the APIs are completed
    let user = JSON.parse(localStorage.getItem("user"));
    this.favoriteStore = user ? user.favoriteStore : "";

    this.isCollege =
      this.pwa.session.features.collegePackAndHold &&
      (user && user.college ? user.college.isCollege : false);

    this.regularBopis = true;

    this.pickupScheduleModal = {};

    this.init();
  }

  /**
   * Amp Before Render for College features
   * @param {CashJsCollection} ampDoc$ - ampDoc fragment
   * @param {URL} urlObj - url being fetched
   */
  async ampBeforeRenderCollege(ampDoc$, urlObj) {
    // if not a college user return
    if (!this.isCollege || !this.pwa.session.collegeAssetsPrefetch) return;

    const isPDP = this.pwa.session.docTests.isPDPReg.test(urlObj.pathname);
    const isPLP = this.pwa.session.docTests.isPLPReg.test(urlObj.pathname);
    if (!isPDP && !isPLP) return;

    let pickerScript = document.createElement("script");
    pickerScript.setAttribute(
      "src",
      "https://cdn.ampproject.org/v0/amp-date-picker-0.1.js"
    );
    pickerScript.setAttribute("async", false);
    pickerScript.setAttribute("custom-element", "amp-date-picker");
    ampDoc$
      .find("head")[0]
      .insertAdjacentHTML(
        "beforeend",
        `<script async="false" custom-element="amp-date-picker" src="https://cdn.ampproject.org/v0/amp-date-picker-0.1.js"></script>`
      );

    await this.pwa.util.waitForProp("template", this.pickupScheduleModal);
    let pickupHtml = this.pickupScheduleModal.template;

    // couldnt find template so asset must not be available in this environment yet
    if (pickupHtml == "not-found") {
      this.isCollege == false;
      return;
    }

    // this.pickupSchedulerModalRender(pickupHtml, ampDoc$);

    this.collegeInfoModalRender(ampDoc$);

    // this.collegeHeadModalRender(ampDoc$);

    if (isPLP) {
      try {
        this.bopisListRender(ampDoc$);
      } catch (e) {
        console.warn(
          `College.bopisListRender: couldn't render the college bopis assets. Error: ${e}`
        );
      }
    }

    if (isPDP) {
      try {
        await this.fulfillmentMsgRender(ampDoc$);
      } catch (e) {
        console.warn(
          `College.fulfillmentMsgRender: couldn't render the college P&H fullfillment msg. Error: ${e}`
        );
      }
    }
  }

  /**
   * Amp Post Render for College features - was only used for date-picker modal, if needed for something else please comment out the date-picker code
   * @param {CashJsCollection} ampBody$ - body of active amp page
   * @param {URL} urlObj - url to that was fetched
   */
  ampPostRenderCollege(ampBody$, urlObj) {
    return;
    if (!this.isCollege || !this.pwa.session.collegeAssetsPrefetch) return;

    const isPDP = this.pwa.session.docTests.isPDPReg.test(urlObj.pathname);
    const isPLP = this.pwa.session.docTests.isPLPReg.test(urlObj.pathname);
    if (!isPDP && !isPLP) return;

    // attach mutation observer to amp-date-picker to perform amplistpostrender-esche modifications
    ampBody$.find("amp-date-picker").each((i, elem) => {
      this.pwa.util.elemAttrEvent(
        elem,
        "class",
        this.ampDatePickerPostRender.bind(this)
      );
      // used for when a user selects a new date
      this.pwa.util.elemAttrEvent(
        elem,
        "date",
        this.pickupSchedulerDateSelected.bind(this)
      );
    });

    // input events for pickup modal
    ampBody$.find(".pSEmailInput").on("input", this.pickupSchedulerEmailInput);
  }

  /**
   * Amp Date picker Post Render - works like ampListPostRender but only called when class of amp date picker is modified - not currently used
   * @param {Mutation Observer} mutatedElem - object from mutation observer
   */
  ampDatePickerPostRender(mutatedElem) {
    // make cash js object out of observed element
    let ampPicker$ = $(mutatedElem.target);

    // modify the mobile date picker when it is finished rendering
    if (ampPicker$.is("#mob-date-picker.i-amphtml-built.i-amphtml-layout")) {
      if (ampPicker$.find(".DayPicker_weekHeader_ul").length > 1) return;
      let weekDayUl = ampPicker$.find(".DayPicker_weekHeader_ul").clone();
      weekDayUl.children().each((i, elem) => {
        elem.removeAttribute("style");
      });
      weekDayUl.addClass("flex just vb05");
      ampPicker$.find(".CalendarMonth_caption").each((i, elem) => {
        elem.insertAdjacentHTML("afterend", weekDayUl[0].outerHTML);
      });
    }

    if (ampPicker$.is("#dsk-date-picker.i-amphtml-built.i-amphtml-layout")) {
      ampPicker$
        .find(".DayPickerNavigation_leftButton__horizontal")
        .addClass("pSLeftButton wHide")
        .on("click", this.pickupSchedulerNavButtonClick.bind(this));
      ampPicker$
        .find(".DayPickerNavigation_rightButton__horizontal")
        .addClass("pSRightButton")
        .on("click", this.pickupSchedulerNavButtonClick.bind(this));
      this.currentSlide = 0;
    }
  }

  /**
   * ampListPostRender for college class
   * @param {CashJSCollection} ampList - amp List from amplistpostrender
   */
  async ampListPostRenderCollege(ampList) {
    if (ampList.is("#csModalList")) {
      const changeStore = await this.pwa.amp.ampGetState("changeStore");
      if (
        this.favoriteStore &&
        this.favoriteStore.isClosest &&
        changeStore.storeId === this.favoriteStore.storeId
      ) {
        ampList.find("#csClosetToCampus").removeClass("hide").addClass("flex");
      }
      return;
    }
    if (!this.isCollege) return;
    if (ampList.is("#plpBopisSddList")) {
      let input$ = ampList.find(`#prodBopisCbPwa`);
      this.bopisListUpdate({ target: input$[0] });
      input$.on("change", this.bopisListUpdate);

      let sddInput$ = ampList.find("#prodSdd");
      sddInput$.on("change", this.bopisListClose);

      let userData = this.userCollegeDataGet();
      if (userData && userData.pickupDate) {
        let date = new Date(userData.pickupDate);
        // check the date and only add to state if the date is valid
        let currDateString = /(.*)T/.exec(new Date().toISOString())[1];
        let currDate = new Date(currDateString);
        if (currDate.getTime() <= date.getTime()) {
          this.parseDate(userData);
          await this.pwa.amp.ampsSetState({
            college: {
              pickUpMsg: `Pickup on ${userData.parsedDate}`,
              selectedDate: date.toISOString(),
            },
          });
          // this.pickupSchedulerModalUpdate(
          //   ampList.closest("body").find("#modalPickupSchedulerWrap"),
          //   userData.email ? userData.email : ""
          // );
        } else {
          // if the date is old, remove from the data object
          const ampUserInfo = await this.pwa.amp.ampGetState("user");
          if (ampUserInfo.data.favoriteStore) {
            delete ampUserInfo.data.favoriteStore.pickupDate;
            delete ampUserInfo.data.favoriteStore.email;
          } else {
            let user = JSON.parse(localStorage.getItem("user"));
            ampUserInfo.data.favoriteStore = user.favoriteStore;
            ampUserInfo.data.college = user.college;
            delete ampUserInfo.data.favoriteStore.pickupDate;
            delete ampUserInfo.data.favoriteStore.email;
          }
          this.userCollegeDataSet(ampUserInfo, true);
        }
      }
      return;
    }

    // handle which radio button is currently checked, update the bopis msg on the page
    if (ampList.is("#collegeBopisList")) {
      let inputs = ampList.find("input");
      if ($(inputs[0]).prop("checked")) {
        this.bopisListRadioChange({ target: inputs[0] });
      }
      if ($(inputs[1]).prop("checked")) {
        this.bopisListRadioChange({ target: inputs[1] });
      }

      inputs.on("change", this.bopisListRadioChange.bind(this));
      return;
    }

    // update bopis message any time plpListInner is rerendered and correct button is checked
    if (ampList.is("#plpListInner")) {
      let bopisBtn$ = ampList.closest("body").find("#collegeBopisPicker");
      if (bopisBtn$.length && bopisBtn$.prop("checked")) {
        this.bopisListRadioChange({ target: bopisBtn$[0] });
      }
      return;
    }
  }

  /**
   * change event handler for when a user clicks on the bopis radio buttons, updates the bopis msg on product tiles when required
   * @param {Event} evt - event from change event or simulated from amplistpostrendercollege
   */
  bopisListRadioChange(evt) {
    let target$ = $(evt.target);
    let bopisMsg;
    let body$ = target$.closest("body");
    if (target$.is("#collegeBopis")) {
      // flag for user selecting normal bopis
      this.regularBopis = true;
      try {
        bopisMsg = `${target$.next().children().text()}`;
      } catch (e) {
        bopisMsg = "Ready in 1 hour";
      }
    }
    if (target$.is("#collegeBopisPicker")) {
      // flag for user selecting pack and hold
      this.regularBopis = false;
      if (this.favoriteStore && this.favoriteStore.pickupDate) {
        try {
          bopisMsg = `${target$.next().find(".collegeBopisMsg").text().trim()}`;
        } catch (e) {
          bopisMsg = "Ready in 1 hour";
        }
      } else {
        bopisMsg = "Pack & Hold";
      }
    }
    if (bopisMsg) {
      // two different versions due to fulfillment array changes, can remove the first version when FFM messages is done
      body$.find(".inlineflex .txtGreen").text(bopisMsg + " at");
      body$.find("[data-cta='plpProductFindInStore'] .txtGreen").text(bopisMsg);
    }
  }

  /**
   * renders necessary assets on plp for the bopis radio buttons
   * @param {CashJSCollection} ampDoc$ - amp doc fragment
   */
  bopisListRender(ampDoc$) {
    let ampBody$ = ampDoc$.find("body");
    ampBody$.addClass("college");
    ampBody$[0].insertAdjacentHTML(
      "beforeend",
      this.collegeBopisList.template[0].outerHTML
    );
    ampBody$.find("#plpBopisSddTemplate")[0].insertAdjacentHTML(
      "beforebegin",
      `<style>
        .collegeExp.plpBopisSddList {
          min-height: 200px;
        }
        .collegeExp #collegeBopisList {
          display: block;
        }
        .collegeBopisCont {
          padding-left: 34px;
        }
        .collegeBopisLbl > * {
          height: 24px;
          vertical-align: middle;
        }
        .plpBopisSddList.i-amphtml-layout-size-defined,  #collegeBopisList.i-amphtml-layout-size-defined {
          overflow: visible!important;
        }
        .prodBopis:not(.prodSDD) {
          width: 92%;
        }
        .collegeTtMsg {
          height: 48px;
          left: -80px;
          width: 200px;
        }
        
        @media (min-width: 48rem) and (max-width: 64rem) {
          .collegeExp.plpBopisSddList {
            min-height: 144px;
          }
        }
      </style>
      <amp-state id="college">
        <script type="application/json">    
            {
                "selectedDate": ""
            }
        </script>
      </amp-state>`
    );
    this.pwa.$$$(ampDoc$[0], ".pickItBopus")[0].insertAdjacentHTML(
      "beforeend",
      `<amp-list 
        binding="always"
        class="vt05 wHide"
        height="80px"
        id="collegeBopisList" 
        items="."
        layout="fixed-height" 
        single-item
        src="amp-state:college"
        [src]="college"
        template="collegeBopisTemp"
      >
      </amp-list>`
    );
    let label = $(
      this.pwa.$$$(ampDoc$[0], `.prodBopisLbl[for="prodBopisCbPwa"]`)
    );
    label
      .find(".freePckup")
      .replaceWith(
        `<span class="green freePckup noTap">FREE Store Pickup</span>`
      );
  }

  /**
   * change event handler for when a user clicks on the sdd button and is a college user, hides the list
   * @param {Event} evt - event from change event
   */
  bopisListClose(evt) {
    let target$ = $(evt.target);
    let ampList$ = target$.closest("#plpBopisSddList");
    if (target$.prop("checked")) ampList$.removeClass("collegeExp");
  }

  /**
   * change event handler for when a user clicks on the bopis button and is a college user
   * @param {Event} evt - event from change event or simulated from amplistpostrendercollege
   */
  bopisListUpdate(evt) {
    let target$ = $(evt.target);
    let ampList$ = target$.closest("#plpBopisSddList");
    if (target$.prop("checked")) ampList$.addClass("collegeExp");
    else {
      ampList$.removeClass("collegeExp");
    }
  }

  collegeHeadModalRender(ampDoc$) {
    let data = {
      bopisChangeNormal: this.bopisChangeNormal,
      bopisChangePNH: this.bopisChangePNH || true,
    };
    const headsUpModalHtml = Mustache.render(
      this.collegeHeadModal.template,
      data
    );

    ampDoc$.find("body")[0].insertAdjacentHTML("beforeend", headsUpModalHtml);
  }

  /**
   * renders the college info modal - https://bedbathandbeyond.atlassian.net/browse/PD-2671
   * @param {CashJSCollection} ampDoc$ - amp doc fragment
   */
  collegeInfoModalRender(ampDoc$) {
    let data = {
      siteId: this.pwa.session.siteId,
    };

    const infoModal = Mustache.render(this.collegeInfoModal.template, data);
    ampDoc$.find("body")[0].insertAdjacentHTML("beforeend", infoModal);
  }

  // closes modal
  closeModal(args, target$) {
    target$.closest(".modal").removeClass("active");
  }

  //contnet stack api can only fetch max of 100 records in single call.
  async collegeListFetchCall(stateId, skipCount) {
    const apiUrl = `https://api-bbby.bbbyproperties.com/api/cms/v3/content_types/college/entries?query={"college_state":"${stateId}"}&include_count=true&skip=${skipCount}&limit=100&asc=school_name&locale=en-us`;
    try {
      const response = await fetch(apiUrl);
      if (response.status === 200) {
        const data = await response.json();
        return data;
      }
    } catch (e) {
      console.warn(
        `College: collegeListFetchCall. Could not get the list of colleges from CONTENT STACK for state: ${stateId}. Error: ${e}`
      );
    }
  }

  async collegeListUpdate(stateId) {
    // shold make this call only for BBBUS
    const collegeData = await this.collegeListFetchCall(stateId, 0);

    let collegeList = collegeData.entries;
    const nextRecords = Math.floor(collegeData.count / 100); // will determine no of api call required.

    // calling the api in loop for next set of records if we have more than 100 records.
    if (nextRecords > 0) {
      for (i = 1; i <= nextRecords; i++) {
        const nextCollegeList = await this.collegeListFetchCall(
          stateId,
          i * 100
        );
        if (nextCollegeList.entries.length > 0)
          collegeList = collegeList.concat(nextCollegeList.entries);
      }
    }

    await this.pwa.amp.ampsSetState({ schoolNames: collegeList });
    return true;
  }

  /**
   * creates college analyticsObj to be added to tealium call for Pack and Hold
   * @param {Object} addCartBody - object from cartAdd function that contains formatted pickupDate for pack and hold
   * @returns {Object} analytics object containing pack and hold properties
   */
  createCollegeAnalyticsObj(addCartBody) {
    let obj;
    try {
      const user = JSON.parse(localStorage.getItem("user")) || {};
      const college = user.college || {};
      const favoriteStore = user.favoriteStore || {};

      // already formatted earlier in cart call
      let pickupDate = addCartBody.addItemResults[0].reserveDate;

      obj = {
        isCollege: college.isCollege || false,
        email: college.email || "",
        pickupDate: pickupDate || favoriteStore.pickupDate || "",
        storeId: favoriteStore.storeId || "",
        storeName: favoriteStore.storeName || "",
      };
    } catch (e) {
      console.warn(
        `College.createCollegeAnalyticsObj: Error making analytics obj. Error: ${e}`
      );
    }

    return obj;
  }

  async fulfillmentMsgRender(ampDoc$) {
    const user = JSON.parse(localStorage.getItem("user"));
    const favoriteStore = user ? user.favoriteStore : { pickupDate: "" };

    this.regularBopis = !favoriteStore.pickupDate;

    let ampBody$ = ampDoc$.find("body");
    ampBody$.addClass("college");

    // Insert college fulfillment template into DOM
    ampBody$[0].insertAdjacentHTML(
      "beforeend",
      this.collegeFulfillList.template[0].outerHTML
    );

    // Format the date
    favoriteStore.parsedDate = this.parseDate(favoriteStore);

    // Insert PH fulfillment styles and initial college state into DOM
    this.pwa.$$$(ampDoc$[0], "#first")[0].insertAdjacentHTML(
      "beforeend",
      `
      <style>
        #collegeFulfillList .pointer.pointer{
          cursor: pointer;
        }
        #collegeFulfillList .ttMsgWrap{
          bottom: 100%;
          right: 0;
        }
        [option=pickItUp] .skuRollup.bopisMsg {
          text-transform: lowercase;
        }
        [option=pickItUp] .skuRollup.bopisMsg:first-letter {
            text-transform: uppercase;
        }
        .bopisMsg > .switchToRegBopis > * {
          color: #000;
          text-decoration: underline;
          cursor: pointer;
        }
      </style>
      <amp-state id="college">
        <script type="application/json">    
            {
                "selectedDate": "${favoriteStore.parsedDate || ""}",
                "selectedPackHold": ${!this.regularBopis}
            }
        </script>
      </amp-state>
      `
    );

    // One list is above the original bopis msg; other list is below. list visibility depends on whether user has chosen pack and hold vs regular bopis
    const phListBefore = $(`
      <amp-list 
        binding="always"
        height="1.2rem"
        class="overflow {{^bopisAvailable}} wHide{{/bopisAvailable}} collegeFulfillList1"
        id="collegeFulfillList" 
        items="."
        layout="fixed-height" 
        single-item
        src="amp-state:college"
        [src]="college"
        template="collegeFulfillTemp"
        [hidden]="!college.selectedPackHold"
        ${this.regularBopis ? "hidden" : ""}
      >
      </amp-list>
    `);
    const phListAfter = $(`
      <amp-list 
        binding="always"
        height="1.2rem"
        class="overflow {{^bopisAvailable}} wHide{{/bopisAvailable}}"
        id="collegeFulfillList" 
        items="."
        layout="fixed-height" 
        single-item
        src="amp-state:college"
        [src]="college"
        template="collegeFulfillTemp"
        [hidden]="college.selectedPackHold"
        ${this.regularBopis ? "" : "hidden"}
      >
      </amp-list>
    `);

    // Insert PH amp-lists above/below original bopis msg in prod fulfillment template
    const bopisMsg = $(
      ampDoc$
        .find("#prodFulfillTemplate2")[0]
        .content.querySelector("[option=pickItUp] .skuRollup.bopisMsg")
    );

    bopisMsg.before(phListBefore);
    bopisMsg.after(phListAfter);

    // Modify the original bopis msg html for various PH scenarios
    bopisMsg.html(`
      <span
        class="{{^bopisAvailable}}wHide{{/bopisAvailable}} collegeBopisOr"
        [hidden]="!college.selectedPackHold"
        ${this.regularBopis ? "hidden" : ""}
      >
        Or,
      </span>
      <span
        class="${
          this.regularBopis
            ? ""
            : "{{#bopisAvailable}}switchToRegBopis{{/bopisAvailable}}"
        } "
        [class]="college.selectedPackHold ? '{{#bopisAvailable}}switchToRegBopis{{/bopisAvailable}}' : ''"
        on="tap:AMP.setState({college: {selectedPackHold: false}})"
        data-click-handler="college.useRegularBopis(true)"
      >
        ${bopisMsg.text()}
      </span>`);

    // no wrappo
    bopisMsg.parent().addClass("grow1");

    // Make sure PH tooltip doesn't get cut off
    this.pwa
      .$$$(ampDoc$[0], "amp-list[template=prodFulfillTemplate2]")[0]
      .classList.add("overflow");
  }

  /**
   * init function to finish appshell prefetches and set up data
   */
  async init() {
    if (!this.isCollege || !this.pwa.session.collegeAssetsPrefetch) {
      return;
    }

    // Wait for all the AJAX and scripts to be available
    let collegeAssetsAndRequirements = await Promise.all(
      this.pwa.session.collegeAssetsPrefetch.concat([
        this.pwa.util.waitForProp("Mustache"),
      ])
    );
    let [template$] = await Promise.all(
      collegeAssetsAndRequirements.map(
        async function (asset) {
          if (!asset.type) return;

          if (asset.type == "json") return await asset.res.json();
          else if (asset.type == "html") {
            return $(await asset.res.text());
          }
        }.bind(this)
      )
    );

    this.pickupScheduleModal = {
      template: template$.find("#pickupScheduleModal").html() || "not-found",
    };
    this.collegeInfoModal = {
      template: template$.find("#collegeInfoModal").html() || "",
    };
    this.collegeBopisList = {
      template: template$.find("#collegeBopisTemp") || {},
    };
    this.collegeFulfillList = {
      template: template$.find("#collegeFulfillTemp") || {},
    };
    this.collegeHeadModal = {
      template: template$.find("#collegeHeadsUpModal").html() || "",
    };
  }

  /**
   * Manually insert "pickup today" before "ready in 1 hour" bopis msg.
   * @param {CashJSCollection} ampList - First #collegeFulfillList amp-list - trigger bopis msg modification only when this list updates
   */
  modifyBopisMsg(ampList) {
    const bopisMsgEl = ampList.parent().find(".skuRollup.bopisMsg");
    if (!bopisMsgEl.length) return;
    if (/pickup today/.test(bopisMsgEl.text())) {
      bopisMsgEl.find(".collegeBopisOr").text("Or ");
    } else if (/hour/.test(bopisMsgEl.text())) {
      bopisMsgEl.find(".collegeBopisOr").text("Or pickup today, ");
    } else {
      bopisMsgEl.find(".collegeBopisOr").text("Or, ");
    }
  }

  /**
   * parses date string from pack & hold pickupDate to the format of "Month day" ex: Jun 16
   * @param {Object} favoriteStore - favorite store object from user object
   * @returns {String} parsed date string
   */
  parseDate(favoriteStore) {
    try {
      const origDate = favoriteStore.pickupDate;
      favoriteStore.parsedDate =
        favoriteStore.pickupDate &&
        new Date(favoriteStore.pickupDate).toLocaleDateString("en", {
          month: "long",
          day: "numeric",
        });
      // If the date has too many chars it will wrap, so use the short version instead ("Sep" instead of "September")
      if (favoriteStore.parsedDate && favoriteStore.parsedDate.length > 9) {
        favoriteStore.parsedDate = new Date(origDate).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
        });
      }
    } catch (e) {
      console.log("Problem parsing PH pickup date", e);
    }

    return favoriteStore.parsedDate;
  }

  /**
   * click event handler for user clicking on pickup scheduler cancel button
   * @param {String} args - argString from data-click-handler
   * @param {CashJSCollection} target$ - target of click event
   */
  async pickupSchedulerCancel(args, target$) {
    // logic to revert day to today or change to normal bopis? currently removes date
    const ampUserInfo = await this.pwa.amp.ampGetState("user");
    if (ampUserInfo.data.favoriteStore) {
      delete ampUserInfo.data.favoriteStore.pickupDate;
      delete ampUserInfo.data.favoriteStore.email;
    } else {
      let user = JSON.parse(localStorage.getItem("user"));
      ampUserInfo.data.favoriteStore = user.favoriteStore;
      ampUserInfo.data.college = user.college;
      delete ampUserInfo.data.favoriteStore.pickupDate;
      delete ampUserInfo.data.favoriteStore.email;
    }

    let modal$ = target$.closest(".modal");
    modal$.find(".modalContent").removeClass("pSPreSelected");
    modal$.find(".pSEmailInput").removeClass("pSLblFocus").val("");

    this.userCollegeDataSet(ampUserInfo, true);

    this.pwa.amp.ampsSetState({
      college: {
        pickupModal: false,
        pickUpMsg: `Reserve pickup date`,
        selectedDate: "",
      },
    });
  }

  /**
   * Amp Date picker Post Render - ran after a user selects a new date
   * @param {Mutation Observer} mutatedElem - object from mutation observer
   */
  pickupSchedulerDateSelected(mutatedElem) {
    const day = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    const month = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    // make cash js object out of observed element
    let ampPicker$ = $(mutatedElem.target);

    // construct date string for display
    let date = new Date(ampPicker$.attr("date"));
    let dateString = `${day[date.getDay()]}, ${
      month[date.getMonth()]
    } ${date.getUTCDate()}, ${date.getFullYear()}`;
    if (/undefined/.test(dateString)) dateString = "Select a date";
    ampPicker$
      .closest("form")
      .find("[data-pickup-date]")
      .text(dateString)
      .removeClass("pSError");
  }

  /**
   * input event handler for user changing email field
   * @param {Object} event - element from input event
   */
  pickupSchedulerEmailInput(event) {
    let target$ = $(event.target);
    let val = target$.val();
    if (val.length == 0) {
      target$.removeClass("pSLblFocus");
    } else {
      target$.addClass("pSLblFocus");
    }
  }

  /**
   * render the pickupScheduler modal and add it to the document
   * @param {String} pickupHtml - html template
   * @param {CashJSCollection} ampDoc$ - amp doc fragment
   */
  pickupSchedulerModalRender(pickupHtml, ampDoc$) {
    let minDate = new Date(),
      maxDate = new Date();
    maxDate.setDate(minDate.getDate() + 90);

    let user = JSON.parse(localStorage.getItem("user"));
    let favStore = user ? user.favoriteStore : "";
    let email = favStore ? favStore.email : "";

    let data = {
      minDate: minDate.toISOString(),
      maxDate: maxDate.toISOString(),
      siteId: this.pwa.session.siteId,
      userEmail: email,
    };

    const pickupModal = Mustache.render(pickupHtml, data);
    ampDoc$.find("body")[0].insertAdjacentHTML("beforeend", pickupModal);
  }

  /**
   * updates the pickup scheduler modal if a user already has selected a date and will update email field
   * @param {CashJSCollection} modal$ - pickup modal
   * @param {String} email - users email (opt)
   */
  pickupSchedulerModalUpdate(modal$, email) {
    modal$.find(".modalContent").addClass("pSPreSelected");

    if (email) {
      modal$.find(".pSEmailInput").addClass("pSLblFocus").val(email);
    }
  }

  /**
   * click event handler for user clicking on left or right navigation buttons
   * @param {Object} event - element from click event
   */
  pickupSchedulerNavButtonClick(event) {
    let target$ = $(event.target);
    if (target$.is(".pSRightButton")) {
      this.currentSlide++;
      target$.prev().removeClass("wHide");
      if (this.currentSlide == 2) {
        target$.addClass("wHide");
      }
    }
    if (target$.is(".pSLeftButton")) {
      this.currentSlide--;
      target$.next().removeClass("wHide");
      if (this.currentSlide == 0) {
        target$.addClass("wHide");
      }
    }
  }

  /**
   * click event handler for user clicking on pickup scheduler submit button
   * @param {String} args - argString from data-click-handler
   * @param {CashJSCollection} target$ - target of click event
   */
  async pickupSchedulerSubmit(args, target$) {
    let form$ = target$.closest("form");
    let formData = this.pwa.util.formToObject(form$);
    if (!this.validateEmail(formData.email)) {
      form$.find(".pSEmailInput").addClass("pSError");
      return;
    } else {
      form$.find(".pSEmailInput").removeClass("pSError");
    }
    if (formData.deliverydate == "") {
      form$.find("[data-pickup-date").addClass("pSError");
      return;
    } else {
      form$.find("[data-pickup-date").removeClass("pSError");
    }

    const month = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "June",
      "July",
      "Aug",
      "Sept",
      "Oct",
      "Nov",
      "Dec",
    ];
    let date = new Date(formData.deliverydate);

    const ampUserInfo = await this.pwa.amp.ampGetState("user");
    if (ampUserInfo.data.favoriteStore) {
      ampUserInfo.data.favoriteStore.pickupDate = formData.deliverydate;
      ampUserInfo.data.favoriteStore.email = formData.email;
    } else {
      let user = JSON.parse(localStorage.getItem("user"));
      ampUserInfo.data.favoriteStore = {};
      Object.assign(ampUserInfo.data.favoriteStore, user.favoriteStore, {
        pickupDate: formData.deliverydate,
        email: formData.email,
      });
      ampUserInfo.data.college = user.college;
    }
    this.userCollegeDataSet(ampUserInfo, true);

    await this.pwa.amp.ampsSetState({
      college: {
        pickupModal: false,
        pickUpMsg: `Pickup on ${month[date.getMonth()]} ${date.getUTCDate()}`,
        selectedDate: date.toISOString(),
      },
    });

    // remove modal open class from appshell and body
    let clone$ = target$.clone();
    clone$.attr("data-modal-close", true);
    this.pwa.util.scrollToggle(this.pwa.session.docObjActive, clone$);

    this.pickupSchedulerModalUpdate(target$.closest(".modal"));
  }

  async setMyStore(storeObj) {
    const [changeStore, changeCollege] = await Promise.all([
      this.pwa.amp.ampGetState("changeStore"),
      this.pwa.amp.ampGetState("changeCollege"),
    ]);
    const storeInfo = JSON.parse(storeObj);
    if (
      changeStore.searchMethod &&
      changeStore.searchMethod === "college" &&
      storeInfo.index === "1"
    ) {
      this.updateFavoriteStoreHandler(storeInfo.storeId);
    }
    this.pwa.site.tealiumClickEventEmitter(
      $(
        `<div data-cta="collegeSetStore" data-attribute="{pnh_college_name: '${changeCollege.schoolName}' , pnh_store_id: '${changeStore.storeId}'}"></div>`
      )[0]
    );
    return;
  }

  userCollegeDataGet() {
    let user = JSON.parse(localStorage.getItem("user"));
    this.favoriteStore = user.favoriteStore;
    return this.favoriteStore;
  }

  userCollegeDataSet(ampUserObj, update) {
    //update localStorage when favoriteStore data isempty and when store changes.
    if (
      !this.favoriteStore ||
      ampUserObj.data.favoriteStore.storeId !== this.favoriteStore.storeId ||
      update
    ) {
      let user = {
        college: ampUserObj.data.college,
        favoriteStore: ampUserObj.data.favoriteStore,
      };
      localStorage.setItem("user", JSON.stringify(user));
      this.userCollegeDataGet();
    }
    return;
  }

  // data-click-handler for user switching between PH and regular bopis on pdp
  useRegularBopis(bool) {
    this.regularBopis = JSON.parse(bool);
  }

  /**
   * updates localStorage object from user clicking set as my store in college finder of store finder modal
   * @param {String} storeId - id of chosen store
   */
  async updateFavoriteStoreHandler(storeId) {
    try {
      const ampUserInfo = await this.pwa.amp.ampGetState("user");
      const userStored = JSON.parse(localStorage.getItem("user"));
      let favoriteStore = ampUserInfo.data.favoriteStore
        ? ampUserInfo.data.favoriteStore
        : userStored && userStored.favoriteStore
        ? userStored.favoriteStore
        : {};
      let college = ampUserInfo.data.college
        ? ampUserInfo.data.college
        : userStored && userStored.college
        ? userStored.college
        : {};
      Object.assign(favoriteStore, {
        storeId: storeId,
        isClosest: true,
      });
      // set date thirty days in the future
      let futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      Object.assign(college, {
        isCollege: true,
        expires: futureDate.toISOString(),
      });
      const user = {
        college,
        favoriteStore,
      };
      localStorage.setItem("user", JSON.stringify(user));
      const userData = this.userCollegeDataGet();

      // only makes this api call if the user is logged in
      if (!this.pwa.user.ATG_PROFILE_DATA) {
        // this is to force the appshell to be reloaded and prefetch the college assets, only way to do it since a user can change their status on the same plp
        if (!this.pwa.session.collegeAssetsPrefetch)
          setTimeout(location.reload.bind(location), 250);
        return;
      }
      const formData = {
        reserveDate: userData && userData.pickupDate,
      };
      const favStoreResObj = await this.pwa.util.statefulFetch(
        `${location.origin}/apis/stateful/v1.0/customers/${this.pwa.user.ATG_PROFILE_DATA}/favourite-store/${storeId}/true`,
        {
          body: formData,
          credentials: "include",
          method: "PUT",
          headers: Object.assign(
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );
    } catch (e) {
      console.warn(
        `College: updateFavoriteStoreHandler. Could not update user favorite store. Error: ${e}`
      );
    }

    // this is to force the appshell to be reloaded and prefetch the college assets, only way to do it since a user can change their status on the same plp
    if (!this.pwa.session.collegeAssetsPrefetch)
      setTimeout(location.reload.bind(location), 250);
    return;
  }

  /**
   * check if the string from email input is correct email format
   * @param {String} email - email string from form
   */
  validateEmail(email) {
    return email.match(
      /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );
  }
}

/**
 * Desktop
 * PWA functions for users on desktop and tablet devices
 * Currently handles functionality for all page types.
 * If this gets bloated, we can break it up into smaller classes (by page type, header fns, etc.)
 */
class Desktop {
  constructor(pwa) {
    this.pwa = pwa;

    // Desktop
    this.isDesktop = window.innerWidth >= 768;
    this.isResized = false;

    // Event Listeners
    window.addEventListener(
      "resize",
      this.pwa.util.onThrottledBegin(this.onResizeBeginRouter.bind(this), 1000),
      { passive: true }
    );
    window.addEventListener(
      "resize",
      this.pwa.util.onThrottledEnd(this.onResizeEndRouter.bind(this)),
      { passive: true }
    );
  }

  // Modal function for PDP SideBar Image
  openImgModal() {
    this.pwa.amp.ampsSetState({ u: { modalImg: true } });
  }

  /**
   * AMP before render functions - PLP
   * @param {CashJsCollection} ampDoc - AMP document
   */
  ampBeforeRenderPlp(ampDoc) {
    if (!this.isDesktop) return;

    this.plpAdsAmpBindMacroParamUpdate(ampDoc);
    this.plpAdsAmpListParamUpdate(ampDoc);
    // this.plpRelatedCategoriesRender(ampDoc);
    // update Criteo IDs for desktop - Browse
    ampDoc
      .find("#viewCategory_mobile-BrowseListing")
      .attr("id", "viewCategory-BrowseListing");
    // update Criteo IDs for desktop - Search
    ampDoc
      .find("#viewSearchResult_mobile-SearchListing")
      .attr("id", "viewSearchResult-SearchListing");
  }

  /**
   * AMP before render functions - PDP
   * @param {CashJsCollection} ampDoc$ - AMP document
   */
  ampBeforeRenderPdp(ampDoc$) {
    if (!this.isDesktop) return;

    // hide same day delivery option if not available for user.

    // PDPv2
    if (ampDoc$.find("body.pdpV2").length) {
      ampDoc$
        .find(".childProdWrap")
        .addClass("active listView")
        .removeClass("gridView");
      ampDoc$.find("#childProdsList").removeAttr("hidden");

      this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "childView", {
        active: true,
        view: "list",
      });
    } else {
      ampDoc$
        .find("#collections")
        .removeClass("accClosed")
        .addClass("accExpanded");
      this.pwa.util.toggleHiddenBeforeRender(
        "#collections .accPanel",
        ampDoc$,
        "u",
        { collExpanded: true }
      );
    }

    // update Criteo IDs for desktop
    ampDoc$.find("#viewItem_mobile-PDP").attr("id", "viewItem-PDP");

    if (!this.pwa.quickView.quickViewLoading)
      this.pwa.desktop.addProdSlideNumb(ampDoc$, 5);

    this.pwa.pdpStickyNav.stickyNavBeforeRender(ampDoc$);
  }

  /**
   * AMP post render functions - PDP
   * @param {CashJsCollection} ampDoc$ - AMP document
   */
  ampPostRenderPdp(ampDoc$) {
    if (!this.isDesktop) return;

    this.pwa.pdpStickyNav.stickyNavPostRender(ampDoc$);
    /*
      For starter pack and PDP sticky img. Probably should have used scroll event
      but didn't want the performance impact
    */
    if (ampDoc$.find(".starterPack").length > 0 || ampDoc$.hasClass("pdpV21")) {
      ampDoc$.addClass("stickyCont");
    }

    /*
      https://bedbathandbeyond.atlassian.net/browse/PPS-6796
      Insert the zoom images on mouseenter so they can start loading after LCP
      but just a little befoe the user opens the image modal
      We do not want the large 2,000px images competeing with the main img
    */
    try {
      if (ampDoc$.find(".prodSlides21").length > 0)
        ampDoc$.find(".prodSlides21")[0].addEventListener(
          "mouseenter",
          function (e) {
            this.pwa.imgZoom.init(ampDoc$, "#prodSlideCarouselSku");
          }.bind(this)
        );
    } catch (e) {
      console.warn(
        `this.pwa.imgZoom.init Unable to add zoom images. Error: ${e}`
      );
    }
  }

  /**
   * AMP before render functions - ALL
   * @param {CashJsCollection} ampDoc - AMP document
   */
  async ampBeforeRenderAll(ampDoc$) {
    if (!this.isDesktop) return;

    // TODO - remove on 7.4.21
    // $(
    //   this.pwa.util.querySelectorAllDomAndTemplate(
    //     ampDoc$[0],
    //     "[data-dsk-click] svg"
    //   )
    // ).addClass("noTap");

    //Initialize amp state for account menu on desktop
    if (!ampDoc$.find("body.navV4")) this.initNavConstants(ampDoc$);
    //load desktop css
    this.pwa.session.desktopCssLoaded = false;
    await this.ampBeforeRenderDeskCss(ampDoc$);

    // setting amp-bind height of marketig banner
    //this.modifyMarketingBanner(ampDoc$, true);

    //Convert Google ad codes to desktop
    this.ampAds(ampDoc$);
  }

  /**
   * AMP post render all functions
   * @param {CashJsCollection} ampDoc$ - AMP document
   */
  ampPostRenderAll(ampDoc$) {
    if (!this.isDesktop) return;

    this.pwa.desktop.makeScrollbarGutter(ampDoc$);

    // setting amp-bind height of marketig banner
    //this.modifyMarketingBanner(ampDoc$, false);

    this.pwa.navPanel.navMouseleaveListenerRegister(ampDoc$);
  }

  /**
   * When modals open and the scrolling is disabled on the appshell body, vertical scrollbar disappears and causes horizontal layout shift.
   * This gets the scrollbar width and if there is one, offsets the appshell and ampBody and creates a fake scrollbar gutter.
   * @param {CashJsCollection} ampDoc$ - AMP document
   */
  makeScrollbarGutter(ampDoc$) {
    if (!ampDoc$.length) return;

    const hasScrollbar =
      window.innerWidth > document.documentElement.clientWidth;

    if (hasScrollbar) {
      let scrollbarWidth;

      ampDoc$.each((i, e) => {
        scrollbarWidth = window.innerWidth - e.clientWidth;
      });

      // Only add gutter css and gutter element if there is actually a scrollbar in the browser window (macOS shows scrollbars as overlays by default)
      if (!scrollbarWidth) return;

      // Add scrollbar gutter css to appshell
      if (!$("style[data-scrollbar]").length) {
        $("head").append(
          $(`
        <style data-wm="appshell" data-scrollbar>
          .PWAMP.modalOpen{
            width: calc(100% - ${scrollbarWidth}px);
          }
          .PWAMP.modalOpen .sbGutter {
            position: fixed;
            display: block;
            top:0;
            bottom: 0;
            right: 0;
            width: ${scrollbarWidth}px;
            height:100vh;
            background: white;
            border-left: 1px solid #E7E7E7;
            z-index: 1000;
          }
        </style>
      `)
        );
      }

      // Add dynamic scrollbarWidth var to amp doc, and create gutter element
      ampDoc$.parent().prepend(
        `<style data-scrollbar>
            body.modalOpen {
              --scrollbarWidth: calc(100% - ${scrollbarWidth}px)
            }
          </style>`
      );
      $("body").append(`<div class="wHide sbGutter"></div>`);
    }
  }

  /**
   * Desktop components that may be on any page and depend on a window resize
   * @param {CashJsCollection} ampBody$ - AMP Body
   */
  async onResizeEndAll(ampBody$) {
    //load desktop css
    await this.ampBeforeRenderDeskCss(ampBody$);

    //this.modifyMarketingBanner(ampDoc, false);

    this.pwa.navPanel.navMouseleaveListenerRegister(ampBody$);

    this.pwa.navPanel.navDskCategoryDragScrollRegister(
      ampBody$.find("#navCategoriesBar")
    );

    this.pwa.appshell.renderCartSticky();

    this.pwa.sayt.topProductsRender(ampBody$.find("#searchSuggestions"));

    $("#sa_s22_instagram, #womp-pp-message").removeClass("invisible");

    if (this.pwa.session.features.registryEnable)
      this.pwa.registry.onResizeEnd(ampBody$);
  }

  /**
   * Resize functions - PLP
   * @param {CashJsCollection} ampBody$ - AMP document body
   */
  onResizeEndHome(ampBody$) {
    // Render home/CLP page product sliders for desktop
    // TODO - refactor renderDskSlider to
    // detect width and do appropriate thing for resolution.
    this.pwa.paginatedSlider.resize(ampBody$, {
      containerClass: "certonaSliderWrap",
      cardClass: "tealium-product-tile",
      carouselSelector: ".sliderContainer",
      cardsVisible: 6,
    });
  }
  /**
   * Resize functions - PLP
   * @param {CashJsCollection} ampBody - AMP document body
   */
  onResizeEndPlp(ampBody) {
    this.plpAdsAmpBindMacroParamUpdate(ampBody);

    // Reposition 3rd party elements
    this.pwa.util.positionAppshellElement(
      "div#sa_s22_instagram[data-page-type][data-count]",
      "#socialannex"
    );

    // Hide extra top-level dropdown menus
    this.plpDropdownFacetRender(ampBody.find("#dskFacetsList"));
  }

  /**
   * Resize functions - PDP
   * @param {CashJsCollection} ampBody - AMP document body
   */
  onResizeEndPdp(ampBody) {
    this.pwa.util.positionAppshellElement("#womp-pp-message", "#ppPlaceholder");
    this.pwa.paginatedSlider.resize(ampBody);

    // setup sticky nav
    //this.pwa.pdpStickyNav.stickyNavBeforeRender(ampBody);
    //this.pwa.pdpStickyNav.stickyNavPostRender(ampBody);
  }

  /**
   * Triggers appropriate desktop functions on first resize event.
   * Only triggers functions for active document.
   */
  onResizeBeginRouter() {
    const ampBody = $(this.pwa.session.docObjActive.shadowBody);
    if (!ampBody.length) return;
    $("#sa_s22_instagram, #womp-pp-message").addClass("invisible");
  }

  /**
   * Triggers appropriate desktop functions on last resize event.
   * If multiple documents are loaded, Triggers desktop
   * resize functions for both visible and hidden documents.
   */
  onResizeEndRouter() {
    this.isDesktop = window.innerWidth >= 768;
    this.isResized = true;
    const docTests = this.pwa.session.docTests;

    for (const ampDocObj of Object.values(this.pwa.session.docs)) {
      // return if host does not have a document in it.
      if (!ampDocObj.href) continue;

      const url = new URL(ampDocObj.href);
      const pathAndSearch = `${url.pathname}${url.search}`;
      const ampBody$ = $(ampDocObj.shadowBody);

      if (docTests.isHomeReg.test(pathAndSearch))
        this.onResizeEndHome(ampBody$);

      if (docTests.isPLPReg.test(pathAndSearch)) this.onResizeEndPlp(ampBody$);

      if (docTests.isPDPReg.test(pathAndSearch)) this.onResizeEndPdp(ampBody$);

      // resize function for elements that occur on all pages
      this.onResizeEndAll(ampBody$);
    }
  }

  /**
   * Updates PLP amp-bind-macro expression for ads display
   * Used on inital render, resize event
   * @param {CashJsCollection} ampContext - jQuery-like Obj - AMP document || AMP body
   */
  plpAdsAmpBindMacroParamUpdate(ampContext) {
    ampContext.find("#prodListSrc").each((i, e) => {
      let ampBindMacro = $(e);
      ampBindMacro.attr(
        "expression",
        this.plpAdsParamReplace(ampBindMacro.attr("expression"))
      );
    });
  }

  /**
   * Updates PLP amp-list src values for ads display
   * Used on resize event
   * @param {CashJsCollection} ampContext - jQuery-like Obj - AMP document || AMP body
   */
  plpAdsAmpListParamUpdate(ampContext) {
    ampContext.find("[data-prod-list-src]").each((i, e) => {
      let ampList = $(e);
      ampList.attr("src", this.plpAdsParamReplace(ampList.attr("src")));
    });
  }

  /**
   * Updates the ad source parameter to match the viewport width.
   * This means ads can be shown between complete rows of 4, 6, or 8 products
   * @param {string} src - amp-bind-macro expression or amp-list src value
   */
  plpAdsParamReplace(src) {
    /* Search PromoteIQ slots */
    let findParam = "&slot=15010";
    let repParam = "&slot=15005";
    /* Category PromoteIQ slots */
    if (
      this.pwa.session.parsedURL &&
      this.pwa.session.parsedURL.basePath &&
      /store\/category\//.test(this.pwa.session.parsedURL.basePath)
    ) {
      findParam = "&slot=15020";
      repParam = "&slot=15015";
    }
    return (
      /* PromoteIQ products - desktop slot */
      src.replace(findParam, repParam)
    );
  }

  /**
   * When a product has wrapping desktop facet options dropdown menus, hide the second row
   * example: (at 1024px width, wide facet option dropdowns)
   * https://em02-www.bbbyapp.com/store/category/dining/table-linens/tablecloths/12142/
   * @param {CashJsCollection} ampList$ - desktop dropdown
   */
  plpDropdownFacetRender(ampList$) {
    // adjust layout after current render cycle completes
    setTimeout(
      function () {
        ampList$.find(".dskPlpOpt").each((i, e) => {
          let menu = $(e);
          if (e.offsetTop) menu.addClass("hide");
          else menu.removeClass("hide");
        });
      }.bind(null, ampList$)
    );
  }

  /**
   * Groups items in PLP L3 related categories carousel for desktop
   * @param {CashJsCollection} ampDoc - AMP document
   */
  plpRelatedCategoriesRender(ampDoc) {
    const winWidth = window.innerWidth;
    if (winWidth < 1024) return;

    // TODO - show more/fewer items on window resize

    const plpCatNavList = ampDoc.find("amp-carousel.plpCatNavList");
    const plpCatNavItms = Array.from(plpCatNavList.find(".plpCatNavItm"));

    // Create containers for desktop carousel
    const containers = [[]];
    let maxItms = 5;
    if (winWidth > 1100) maxItms = 6;
    if (winWidth > 1250) maxItms = 7;

    plpCatNavItms.forEach((item) => {
      if (containers[containers.length - 1].length < maxItms) {
        containers[containers.length - 1].push(item);
      } else {
        containers.push([item]);
      }
    });

    containers.forEach((container) => {
      const wrapper = $(
        '<div class="relatedCatsContainer" style="display:flex!important;justify-content:center;"></div>'
      );
      wrapper.append(container);
      plpCatNavList.append(wrapper);
    });
    plpCatNavList.attr("type", "slides");
  }

  /**
   *
   * @param {Number} brkPt - breakpoint to check before setting state
   * @param {Object}  stateObj - State to set
   * @param {String}  comparison - Operator used to test breakpoint
   * @returns {Boolean} - success of set state;
   */
  async setStateOnBrkPt(brkPt, stateObj, comparison = ">=") {
    const w = window.innerWidth;
    const setState = setStateFn.bind(this);
    switch (comparison) {
      case ">=":
        if (w >= brkPt) {
          return await setState(stateObj);
        }
        break;
      case ">":
        if (w > brkPt) {
          return await setState(stateObj);
        }
      case "<":
        if (w < brkPt) {
          return await setState(stateObj);
        }
        break;
      case "<=":
        if (w <= brkPt) {
          return await setState(stateObj);
        }
      case "==":
        if (w == brkPt) {
          return await setState(stateObj);
        }
      default:
        return false;
    }
    async function setStateFn(obj) {
      try {
        await this.pwa.amp.ampsSetState(obj);
        return true;
      } catch (e) {
        console.warn(`Unable to set state for object ${obj}, with error: ${e}`);
        return false;
      }
    }
  }

  /**
   * Adds a number and element to one of the image slides on desktop
   * @param {CashJsCollection} node - probably ampBody
   */
  addProdSlideNumb(node, number) {
    if (window.innerWidth < 1024) return;
    let isPdpV21 = this.pwa.session.isPdpV21;
    node.find(".prodSlideSelector").each(function () {
      let select = $(this);
      let cnt = select.find("[data-cta='prodThumbSlide']").length;
      const opt = select.find("[data-cta='prodThumbSlide']").eq(number - 1);
      const optSeeMore = select.find("[data-cta='prodThumbSlide']")[4];
      if (cnt >= number && opt.find(".prodImgSeeMore").length == 0) {
        let imgMore = isPdpV21
          ? `<span class="dBRad0375  vp05 gp05 black s12 sHide tHide flex bold midCtr whiteBg noTap txtCtr prodImgSeeMore2">+${
              cnt - (number - 1)
            } more</span>`
          : `<span class="sHide tHide flex midCtr noTap txtCtr prodImgSeeMore">See ${
              cnt - (number - 1)
            } more</span>`;
        if (
          opt.find(".prodImgSeeMore2,.prodImgSeeMore").length == 0 &&
          opt.closest(".placeholder").length == 0
        )
          opt.append(imgMore);

        opt.addClass("seeMore");
        optSeeMore.setAttribute("data-click-handler", "desktop.openImgModal");
      }
    });
  }

  /**
   * Appends Desktop CSS styles
   * @param {CashJsCollection} ampDoc - jQuery like amp Document object
   */
  async ampBeforeRenderDeskCss(ampDoc) {
    if (this.pwa.session.desktopCssLoaded) return;
    const session = this.pwa.session;

    let ampDocCssVersion =
      ampDoc.find("html").attr("data-version") || session.cssVersion;
    ampDocCssVersion = parseInt(ampDocCssVersion);
    if (ampDocCssVersion <= 357) ampDocCssVersion = 358;

    // Avoid populating CDN with CSS 404s
    // Akamai will store a CSS 404 in the cache for 1 year
    // This can happen if the appshell has trouble uploading new desktop CSS and an amp page requires it first
    // $('#deskStyles').attr('data-css-version') is 1 on dev appshell
    let appshellCssVersion =
      $("#deskStyles").attr("data-css-version") || this.pwa.session.cssVersion;
    if (ampDocCssVersion > appshellCssVersion)
      ampDocCssVersion = appshellCssVersion;

    // inject css inlined
    // should be prefetched in appshell
    try {
      // prod script is being used
      var cssFileName = `desktop_v${ampDocCssVersion}_id${session.wompSiteId}.css`;

      // building appshell locally wth ampEngine.js or working in staging environment
      if (window.wData || this.pwa.session.isPreprod) {
        cssFileName = `staging_desktop_v${ampDocCssVersion}_id${session.wompSiteId}.css`;
      }
      // create the desktop.css hrefa
      // XXX ToDo, modify this link to inject staging version for testing
      let deskCssSrc = `/amp/7865/${cssFileName}`;
      // not waiting here, so html could paint before CSS is downloaded if prefetch did not work, or caching is disabled
      const deskCssRes = await fetch(deskCssSrc);
      session.deskCss = await deskCssRes.text();
    } catch (ex) {
      console.error("Error fetching desktop.css", ex);
    }
    let body$ = ampDoc.find("body").length !== 0 ? ampDoc.find("body") : ampDoc;
    body$.prepend($(`<style>${session.deskCss}</style>`));
    this.pwa.session.desktopCssLoaded = true;
  }

  /**
   * Sets height on marketing banner on initial load since bind doesn't fire right away.
   * @param {CashJsCollection} ampDoc - jQuery like amp Document object
   */
  async modifyMarketingBanner(ampDoc, load) {
    let mktgBanner = ampDoc.find("#marketingBannerCarousel");
    if (load) {
      mktgBanner.attr("height", "35");
    } else if (mktgBanner.length > 0) {
      // setting amp-bind height of marketig banner
      await this.setStateOnBrkPt(768, { mBanHeight: 35 });
      // setting amp-bind height of marketing banner for mobile
      await this.setStateOnBrkPt(768, { mBanHeight: 80 }, "<");
    }
  }

  /**
   * click handling for desktop PLP filters
   * @param {CashJsCollection} ele - Target of element clicked
   * @returns {Boolean} - success of operation
   */
  plpFacetClick(ele) {
    // TODO - if (wmPwa.session.features.plpLeft) return;
    const isInvalidRange = ele
      .closest("body")
      .find(".plpFilterRange.invalidRange").length;
    // Dont close if clicking inside an input or if the user-defined range is invalid
    if (ele.is(".plpRangeIpt, .plpFSIpt") || isInvalidRange) return;

    // Ok to close the facets dropdown
    // body click
    let facet = ele.closest(".dskPlpOpt").not(".active");
    ele.closest("body").find(".dskPlpOpt").removeClass("active");
    facet.addClass("active");
    ele.closest(".dskFacetsPills.invalidRange").removeClass("invalidRange");
    return true;
  }

  /**
   * change ad code for amp ads on desktop
   * @param {CashJsCollection} ele - CashJS collection that contains the ad elements
   * @returns {Boolean} - success of operation
   */
  ampAds(obj$) {
    // Might need to make a function for resize, but probbably need to replace the ads entirely
    if (window.innerWidth < 1024) return false;

    $(this.pwa.$$$(obj$[0], "amp-ad")).each((i, e) => {
      const ampAd = $(e);

      let slot = ampAd.attr("data-slot");
      if (slot)
        ampAd.attr(
          "data-slot",
          slot.replace(/mweb/gi, "").replace(/_Mweb_/gi, "_")
        );

      let adJson = ampAd.attr("json");
      if (adJson) ampAd.attr("json", adJson.replace(/_Mweb_/gi, "_"));

      let adMultiSize = ampAd.attr("data-multi-size");
      if (adMultiSize && !/AboveProduct/i.test(ampAd.attr("id")))
        ampAd.attr("data-multi-size", "970x250,728x90,1x1");

      // console.log(ampAd.outerHTML());
    });
    return true;
  }
  /**
   * Initialize the navState object on first click
   * Usually this happens when a user clicks on the burger menu
   * since the desktop menu doesn't have that initial click, we set it here
   */
  async initDskMenu(ampBody) {
    if (window.innerWidth < 1280) return;
    let navState = await this.pwa.amp.ampGetState("navState");
    if (navState && navState.nav2Obj && navState.nav3Obj) return;

    try {
      let nav = await this.pwa.amp.ampGetState(
        /navV1/.test(ampBody[0].className) ||
          ampBody[0].getAttribute("data-version") >= 311
          ? "navV1Data"
          : "nav"
      );
      let categories = nav.data.filter((item) => {
        return item.label.toLowerCase() == "categories";
      });
      if (categories.length > 0) {
        let nav3 = !navState.nav3Obj ? null : navState.nav3Obj;
        let nav3Header = navState.nav3Header;
        if (categories[0].items.length > 0 && nav3 == null) {
          nav3 = categories[0].items[0][0];
          nav3Header = nav3.label;
        }
        this.pwa.amp.ampsSetState({
          navState: {
            nav2Obj: categories[0],
            nav3Obj: nav3,
            nav3Header: nav3Header,
          },
        });
      }
    } catch (e) {
      console.warn(
        `Unable to set categories nav object for desktop menu. Error: ${e}`
      );
    }
  }

  /**
   * This function initializes the nav account state.
   * This is normally done when the user clicks on the burger menu
   * The account info is triggered on hover, so we set the state here
   * This is only to check if a user is authenticated and get their username
   * @param {Event Object} e - mouseover event
   */
  async initAcctState(e) {
    if (window.innerWidth < 1280) return;
    try {
      const [user, nav] = await Promise.all([
        this.pwa.amp.ampGetState("user"),
        this.pwa.amp.ampGetState("nav"),
      ]);
      // JW - 6.4.21 - disabling until we can test this.
      if (
        (this.pwa.session.isDebug &&
          nav.authenticated == false &&
          user.data.loginStatus != null &&
          user.data.loginStatus != "0") ||
        (user.data.userFirstName && nav.username !== user.data.userFirstName)
      ) {
        this.pwa.amp.ampsSetState({
          nav: {
            authenticated:
              user.data.loginStatus != null && user.data.loginStatus != "0",
            username: user.data.userFirstName ? user.data.userFirstName : "",
          },
        });
      }
    } catch (e) {
      console.error(`Unable to set account state. Error: ${e}`);
    }
  }

  /**
   * Used to initialize navigation contstants
   * normally this is done on user click, but since desktop uses hover, we set the state here
   * @param {CashJsCollection} doc$ - amp document;
   */
  async initNavConstants(doc$) {
    if (window.innerWidth < 1280) return;
    try {
      const contstants = this.pwa.amp.ampGetStateBeforeRender(
        doc$,
        "navConstants"
      );
      this.pwa.amp.ampSetStateBeforeRender(doc$, "nav", {
        constants: contstants.contstants,
        accountData: contstants.accountData,
        authenticated: false,
        username: "",
      });
    } catch (e) {
      console.warn(`Error trying to initialize acct state`);
    }
  }
}

class PDPStickyNav {
  constructor(pwa, stickySelector, options) {
    this.pwa = pwa;
    this.stickySelector = stickySelector;
    this.io = undefined;
    this.options = {
      stickyNavId: "pdpStickyMenu",
      stickyHeadId: "headerStickyNav",
      linkClass: "pdpTabLink",
      sectionAttr: "data-sectionId",
      sectionClass: "pdpNavSection",
      headToggleClass: "pdpStickyActive",
      stickyHeadClass: "pdpNavTabsContHead",
      breakpoint: 1280,
    };
    Object.assign(this.options, options);
  }
  /**
   * Setup the intersection observers for the PDP sticky nav
   * @param {CashJsCollection} body$ - cash reference for document intersection was fired from
   * @returns undefined
   */
  stickyNavPostRender(body$) {
    if (
      window.innerWidth < this.options.breakpoint ||
      body$.find(`#${this.options.stickyNavId}`).hasClass("pdpNavTabsCont2")
    )
      return;
    this.pwa.intersectHandlersRegister(
      "stickySections",
      body$,
      `.${this.options.sectionClass}`,
      this.stickyNavIntersectionHandler.bind(this),
      { threshold: 0, rootMargin: "-20% 0px -79% 0px" }
    );
    this.pwa.intersectHandlersRegister(
      "pdpStickyNav",
      body$,
      `#${this.options.stickyNavId}`,
      this.headerStickyIntersectHandler.bind(this),
      { threshold: [0, 0], rootMargin: "-100px 0px 0px 0px" }
    );
    return;
  }
  /**
   *
   * @param {CashJsCollection} body$ - Reference to the doc where we are going to setup the sticky
   * @returns undefined
   */
  stickyNavBeforeRender(body$) {
    if (
      window.innerWidth < this.options.breakpoint ||
      body$.find(`#${this.options.stickyNavId}`).hasClass("pdpNavTabsCont2")
    )
      return;
    this.createHeaderSticky(body$.find(`#${this.options.stickyNavId}`), body$);
    return;
  }
  /**
   *
   * @param {Class} pwa - refernce to main pwa class
   * @param {IntersectionEntry} item - intersection observer event
   * @returns undefined
   */
  stickyNavIntersectionHandler(pwa, item) {
    const trigger = $(item.target);
    if (!trigger.length > 0 || item.intersectionRatio == 0) return;
    let triggerId = $(trigger).attr("id");
    let navSection = trigger.closest("body");
    let navItem = navSection.find(
      `[${this.options.sectionAttr}='${triggerId}']`
    );
    if (item.boundingClientRect.height > 0) {
      navSection
        .find(`.${this.options.linkClass}.active`)
        .removeClass("active");
      if (navItem.length > 0) {
        navItem.addClass("active");
      }
    }
    return;
  }
  /**
   *
   * @param {CashJsCollection} stickyNav$ - Cash node that we will copy
   * @param {CashJsCollection} body$ - Body DOM collection where we will insert the sticky
   * @returns Boolean
   */
  createHeaderSticky(stickyNav$, body$) {
    if (
      body$.find(`#${this.options.stickyHeadId}`).length > 0 ||
      stickyNav$.length == 0
    )
      return;
    try {
      let stickyNavCopy = stickyNav$.clone();
      stickyNavCopy.attr("id", "").addClass();
      // JW - insertAdjacentHTML to avoid - Uncaught TypeError: Cannot read property '__AMP_TOP' of null
      body$
        .find("header")[0]
        .insertAdjacentHTML(
          "beforeend",
          `<div id="${this.options.stickyHeadId}" class="${this.options.stickyHeadClass}"> ${stickyNavCopy[0].outerHTML}</div>`
        );
      return true;
    } catch (e) {
      this.pwa.errorCustom(`Error cloning sticky nav into header`, {
        err: e,
      });
    }
    return false;
  }
  /**
   *
   * @param {Class} pwa - Main PWA class
   * @param {IntersectionEntry} entry - Event object from intersection observer
   * @returns Boolean
   */
  headerStickyIntersectHandler(pwa, entry) {
    const bd = $(entry.target).closest("body");
    if (entry.intersectionRatio == 0 && entry.boundingClientRect.top < 50) {
      bd.addClass(`${this.options.headToggleClass}`);
      return true;
    }
    bd.removeClass(`${this.options.headToggleClass}`);
    return false;
  }
}

class ImgZoom {
  constructor(pwa, opt) {
    this.pwa = pwa;
    const options = Object.assign({}, opt);
    this.slideSelector = ".prodSlide";
    // Height and width of the img used to display the zoom effect
    this.zoomImgWidth = options.zoomImgWidth || 2000;
    this.zoomImgHeight = options.zoomImgHeight || 2000;
    // Selector for the slide that is active.
    this.activeSlideSelector =
      options.activeSlideSelector ||
      ".i-amphtml-carousel-slide-item[aria-hidden='false']";
    // Selector for the node that contains the base img src
    this.mainImgSelector = options.mainImgSelecor || "amp-img, amp-layout";
    this.initialized = false;
  }

  /**
   * This function adds large images used for zooming in on an image
   * This can be called asynchonously without an await so it is non-blocking
   * The container is usually parent that holds many images
   * The event container is the container that holds all the slides
   * The zoom selector is the selector of the node where the current image resides and where
   * the larger zoom image will be placed
   * @param {CashJSCollection} cont - container for all the images.
   * @param {String} evtSel - Selector of node to attach the mouse events
   * @param {String} zoomSelector - Optional selector where the large zoom img will be placed
   */
  async init(cont, evtSel, zoomSelector) {
    this.slideSelector = zoomSelector || this.slideSelector;
    const evtHost = cont.find(evtSel);
    if (evtHost.attr("data-imgZoom")) return;
    this.modal$ = evtHost.closest(".modalImg");
    this.zoomOnPage = !cont.closest("body").hasClass("pdpV21");
    try {
      this.insertZoomImg(evtHost);
      this.addZoomEvents(evtHost);

      this.initialized = true;
      evtHost.attr("data-imgZoom", true);
    } catch (e) {
      console.warn(`Error in init for imgZoom. Error: ${e}`);
    }
  }

  /**
   * This setups up the events. This should only be called once. This should not be called directly
   * but as part of the init function
   * @param {CashJsCollectioin} cont - container where mouse interaction events will be attached
   */
  addZoomEvents(cont) {
    // Tried debouncing but it just doesn't work as user's need immediate feedback
    if (cont.length > 0) {
      const imgZoom = this.imgZoom.bind(this);
      const imgOut = this.imgOut.bind(this);
      cont[0].addEventListener("mouseenter", imgZoom);
      cont[0].addEventListener("mousemove", imgZoom);
      cont[0].addEventListener("mouseleave", imgOut);
      cont[0].addEventListener("click", imgOut);
      return true;
    }
    return false;
  }

  /**
   * This is the function that handles the interaction on mouseover and mousemove
   * @param {Event} evt - Mouse Event
   */
  imgZoom(evt) {
    try {
      const zCont = $(evt.currentTarget).find(this.activeSlideSelector);
      if (!this.modal$.hasClass("active") && this.zoomOnPage == false) return;
      let zoomImg = zCont.find(".zoomImg");
      if (zoomImg.length == 0) return;
      const coord = this.getMouseOffsets(evt, zCont[0]);
      zoomImg.css({
        zIndex: 1,
        height: "2000px",
        width: "2000px",
        transform: `translate(${coord.x}px,${coord.y}px)`,
        pointerEvents: "none",
        opacity: 1,
        objectFit: "cover",
      });
      zoomImg.removeClass("hide");
    } catch (e) {
      console.warn(`Error zooming img. Error: ${e}`);
    }
  }

  /**
   * This hides the zoomed img
   * @param {Event} evt - Event from mouseleave
   */
  imgOut(evt) {
    $(evt.currentTarget).find(".zoomImg").css("opacity", 0);
  }

  /**
   * This function is responsible for getting the slides
   * Getting the src from the regular img
   * Changing the height and width attributes
   * And inserting each individual img into the slide container
   * @param {CashJsCollectioin} cont - Container that holds the individual slides
   */
  async insertZoomImg(cont) {
    const zoomUrl = this.createZoomUrl;
    const mSel = this.mainImgSelector;
    const w = this.zoomImgWidth;
    const h = this.zoomImgHeight;
    cont.find(this.slideSelector).each(function (ind, item) {
      let img = $(this).find(mSel);
      if (img.length == 0) return true;
      let imgSrcObj = new URL(img.attr("src"));
      let cgcImageZoom = img.attr("data-cgc-image-zoom");
      let zoomSrc = cgcImageZoom || zoomUrl(imgSrcObj, w, h);
      let zoomAltTxt = "Zoomed image of " + img.attr("alt");
      let zoomImg = `<img class="zoomImg" style="opacity: 0" src="${zoomSrc.toString()}" alt="${zoomAltTxt}">`;
      $(this).append(zoomImg);
    });
  }

  /**
   *
   * @param {URL} urlObj - the url for the img src
   * @param {Number} wd - Width of zoom img
   * @param {Number} ht - Height of zoom img
   */
  createZoomUrl(urlObj, wd, ht) {
    let params = urlObj.searchParams;
    params.set("wid", wd);
    params.set("hei", ht);
    urlObj.search = params.toString();
    return urlObj;
  }

  /**
   *
   * @param {Mouse Event} evt- mouse event
   * @param {DOM Node} targ - container where event was attached
   */
  getMouseOffsets(evt, targ) {
    const rect = targ.getBoundingClientRect();
    const hRat = (this.zoomImgWidth - rect.width) / rect.width;
    const vRat = (this.zoomImgHeight - rect.height) / rect.height;
    const x = (evt.pageX - rect.left) * hRat;
    const y = (evt.pageY - rect.top) * vRat;
    return { x: -Math.abs(x), y: -Math.abs(y) };
  }
}

/**
 * Class is used to display the pick it modal
 * This modal is opened from PLP or PDP.
 * On PDP user clicks on the store name
 * On PLP user click on link in product tile that says "find in other stores"
 * This is also used to display the Post ATC cart error modal
 * The cart error modal is displayed when the cart returns specific OOS error codes
 * These same modals used to exist in the amp pages, however we moved to appshell to reduce amp binds,
 * reduce page size and allows us to appropriately set cookies when a user changes their store location
 * Mockup: https://app.zeplin.io/project/6185735e7edc2f34a1824e8b/screen/61a543437e131d88f241ff93
 * Revised mockup: https://app.zeplin.io/project/6185735e7edc2f34a1824e8b/screen/61ddc2d6370f3727f61195ef
 * Jira Story: https://bedbathandbeyond.atlassian.net/browse/PP-2948
 * https://bedbathandbeyond.atlassian.net/browse/PP-2947
 * https://bedbathandbeyond.atlassian.net/browse/PP-2946
 * https://bedbathandbeyond.atlassian.net/browse/PP-3167 - change store modal
 *
 * This class is also extened by the DeliveryModal class to display the delivery modal
 */
class PickItModal {
  constructor(pwa) {
    this.pwa = pwa;
    this.templateProp = "fulfillmentModalTemp";
    this.modalId = "fulfillmentModal";
    this.searchRadius = 50;
    this.modalState = {};
    this.radiusSelector = [5, 10, 15, 20, 25, 50];
  }

  /**
   * Render the prod Pick it modal.
   * Currently only displayed when the cart MS returns an oos error.
   * With some modification, it could replace the current pick it modal in PWA if we wanted to reduce amp binds binds
   * @param {Boolean} clearData - if this is set to true, all the data is fetched again for the modal, if false, modal is rendered using the internal data (this.modalState)
   * @param {Object} obj - if this is called from cart error, this is the obj that is returned from the cart MS. If this is the pick it modal, it is an object that contains the necessary data to render the modal (obj.prodId - for plp and obj.isPickIt, obj.isDeliverIt, obj.isPickIt)
   * @param {Promise[Object,String]} cartSliderFetches[data,template] - this contains the data and the template for the cart slider (recommendataions)
   * @returns {Boolean} - success of the render
   */
  async render(clearData, obj, cartSliderFetches) {
    try {
      this.pwa.util.scriptAddMustache();
      let req = await Promise.all([
        this.pwa.session[this.templateProp],
        this.pwa.util.waitForProp("Mustache"),
      ]);
      let template = req[0];
      if (clearData) {
        this.modalState = undefined;
        this.modalState = await this.getModalData(obj);
        if (!this.modalState)
          throw new Error(
            `PickItModal.render unable to get data to render modal: Error: ${e}`
          );
      } else {
        template = $(template).find("#formSection").html();
      }
      if (!this.modalState) return;
      let modalHtml = Mustache.render(template, this.modalState);
      this.pwa.appshell.elems.loadingOverlay.removeClass("loading");
      if (clearData) {
        this.closeModal();
        $("body").append(modalHtml);
      } else {
        $("#formSection").html(modalHtml);
      }
      this.search();
      if (cartSliderFetches) {
        this.addSlider(cartSliderFetches);
      }
      return true;
    } catch (e) {
      console.warn(
        `PickItModal.render: Unable to render cart OOS modal. Error: ${e}`
      );
    }
    return false;
  }
  /**
   * Fetches the appshell template for rendering the modal
   * @returns {String|undefined} - string for rendering the modal
   * Adds the template to the session object
   */
  async loadTemplate() {
    try {
      if (!this.pwa.session[this.templateProp]) {
        // if we do not have a cart template, lets fetch it
        this.pwa.session[this.templateProp] =
          this.pwa.appshell.fetchAppshellTmp(
            this.pwa.session.apiInfo.pickItModal,
            `fulfillmentModal`
          );
        return this.pwa.session[this.templateProp];
      }
      return this.pwa.session[this.templateProp];
    } catch (e) {
      console.warn(
        `PickItModal.loadTemplate: Error in fetching the pickItModal template. Error: ${e}`
      );
    }
    return;
  }
  /**
   *
   * @param {Object} obj - object used to fetch the data. Must contain the following values: obj.prodId (for plp) and obj.isPickIt, obj.isDeliverIt, obj.isPickIt
   * @returns {Object} - data used to render the modal for PLP or PDP
   */
  async getModalData(obj) {
    // Need to make this work also for PLP
    let pickItData = undefined;
    let cartError = obj.cartError;
    let fulfillmentType = "shipping";
    if (obj.isPickIt || obj.isDeliverIt) {
      fulfillmentType = obj.isPickIt ? `at your store` : "same day delivery";
    }
    try {
      const [changeStore, storeInfo] = await Promise.all([
        this.pwa.amp.ampGetState("changeStore"),
        this.pwa.amp.ampGetState("storeInfo"),
      ]);
      if (this.pwa.session.docTests.isPDPReg.test(location.pathname)) {
        // PDP specific data
        let prodId = obj ? obj.prodId : this.pwa.util.prodIdGet(location);
        const [skuDet, skuFacets] = await Promise.all([
          this.pwa.pdpDataAbstraction.getSkuDetails(prodId),
          this.pwa.amp.ampGetState(`skuFacets${prodId}`),
        ]);
        delete skuDet.data;
        pickItData = {
          qty: skuFacets.qty,
          DISPLAY_NAME: skuDet.DISPLAY_NAME,
          IMG: {
            imageId: skuDet.PRODUCT_IMG_ARRAY[0].imageId,
            desc: skuDet.PRODUCT_IMG_ARRAY[0].description,
          },
          skuId: skuFacets.skuId,
          skuFacets: skuFacets,
          prodId: prodId,
          isBackorder: skuDet.isBackorder || false,
        };
      } else {
        // PLP specific Data
        let item = await this.pwa.plp.getPlpItemData(obj.prodId);
        /* On amp to PWA atc transition, sometimes prodList hasnt' loaded before this is called. Try again */
        if (!item) item = await this.pwa.plp.getPlpItemData(obj.prodId);
        pickItData = {
          qty: 1,
          DISPLAY_NAME: item.DISPLAY_NAME,
          IMG: {
            imageId: item.scene7imageID,
            desc: item.DISPLAY_NAME,
          },
          skuId: item.SKU_ID && item.SKU_ID.length > 0 ? item.SKU_ID[0] : "",
          prodId: item.PRODUCT_ID,
          isBackorder: item.BACKORDER_FLAG || false,
        };
      }
      let postalCode = "",
        currentLocation = "",
        selectedStore = "",
        onlyAvailable = true;
      try {
        postalCode =
          storeInfo.data &&
          storeInfo.data.store &&
          storeInfo.data.store.postalCode
            ? storeInfo.data.store.postalCode
            : "";
        currentLocation =
          changeStore.location ||
          (storeInfo.data &&
            storeInfo.data.store &&
            storeInfo.data.store.postalCode)
            ? storeInfo.data.store.postalCode
            : "";
        selectedStore = storeInfo.data.store.commonName;
        selectedStore +=
          storeInfo.data.store.storeType == 40
            ? " buybuy BABY"
            : storeInfo.data.store.storeType == 30
            ? " Harmon"
            : " Bed Bath & Beyond";
        onlyAvailable = changeStore.onlyAvailableStores;
      } catch (e) {
        console.log(`PickItModal no stores found. Error: ${e}`);
      }
      let radiusObj = this.radiusRender();
      pickItData = Object.assign(pickItData, {
        isPickIt: obj.isPickIt || false,
        isShipIt: obj.isShipIt,
        isDeliverIt: obj.isDeliverIt || false,
        storeRadius: this.searchRadius,
        fulfillmentType: fulfillmentType,
        radiusSelector: radiusObj,
        postalCode: postalCode,
        unitDistance: this.pwa.session.isCANADA ? "km" : "Miles",
        currentLocation: currentLocation,
        scene7RootPath: this.pwa.session.apiInfo.scene7RootUrl,
        onlyAvailableSelected: cartError
          ? cartError
          : onlyAvailable
          ? onlyAvailable
          : true,
        onlyAvailableStores: false,
        showClForm: !currentLocation ? true : false,
        cartError: cartError,
        changeStore: changeStore,
        storeName: selectedStore,
        modalTemplate: true,
      });
    } catch (e) {
      console.warn(
        `PickItModal.getModalData: Unable to get data to render prod pick it modal. Error: ${e}`
      );
      pickItData = false;
    }
    return pickItData;
  }
  /**
   *
   * @returns {Array} - An array of objects for rendering the radius selector in the change location form
   * This checks the currently selected radius value and creates an array of object that can be easily rendered
   * by Mustache
   */
  radiusRender() {
    return this.radiusSelector.map((radius) => {
      return {
        radius: radius,
        selected: radius == this.searchRadius ? "selected" : "",
      };
    });
  }
  /**
   *
   * @param {CashJs Form Node} form$ - (optional) this is the change location form. If the form is not included, we render the modal with the exhisting location data on this.modalState
   * @returns {Boolean} - success of rendering store data
   */
  async search(str, form$, evt) {
    let location = undefined;
    let storeHtml = "";
    try {
      if (form$) {
        location = form$.find("#clFormLocale").val();
        if (!location || location.length == 0) {
          this.changeState(
            this.modalState,
            { changeStoreErr: true, showClForm: true },
            true
          );
        } else {
          if (this.modalState.changeStore) {
            this.modalState.changeStore.location = location;
            this.changeState(
              this.modalState,
              {
                currentLocation: location,
                showClForm: true,
              },
              true
            );
            return true;
          }
        }
      }
      if (this.modalState.currentLocation || location) {
        $("#alStoreStockResults").html("Loading...");
        let storeData = await this.getStoreData(
          location || this.modalState.currentLocation
        );
        storeData = Object.assign(storeData, {
          storeTemplate: true,
          href: `${window.location.origin}${window.location.pathname}`,
          qty: this.modalState.qty,
          skuId: this.modalState.skuId,
          prodId: this.modalState.prodId,
          currentLocation: this.modalState.currentLocation,
          storeRadius:
            this.searchRadius || this.modalState.changeStore.searchRadius,
          unitDistance: this.modalState.unitDistance,
          cartError: this.modalState.cartError,
        });
        storeData.data.otherStores = this.modifyStoreData(
          storeData.data,
          this.modalState.onlyAvailableSelected
        );
        if (storeData.data.otherStores.length > 2) {
          storeData.data.displayStores = storeData.data.otherStores.slice(0, 2);
        } else {
          storeData.data.displayStores = storeData.data.otherStores;
          storeData.data.hideShowMore = true;
        }
        this.storeData = storeData;
        storeHtml = await this.renderStoreData(this.storeData);
      }
    } catch (e) {
      console.warn(
        `PickItModal.search: Unable to get storeData for cart error modal. Error: ${e}`
      );
      storeHtml = `<div class="vp05 gp1 panelAlert">There was an error trying to load the store data. Please try again.</div>`;
    }
    $("#alStoreStockResults").html(storeHtml);
    return true;
  }
  /**
   *
   * @param {Object} storeData - store data to render in the store container from the /search/sku MS
   * @returns {String} - string to insert in the store container
   * deliveryModal also extends this method
   */
  async renderStoreData(storeData) {
    let storeHTML = "";
    try {
      let req = await Promise.all([
        this.pwa.session[this.templateProp],
        this.pwa.util.waitForProp("Mustache"),
      ]);
      storeHTML = Mustache.render(req[0], storeData);
    } catch (e) {
      console.warn(
        `PickItModal.renderStoreData: Problem render store data. Error: ${e}`
      );
    }
    return storeHTML;
  }
  /**
   * This function massages the data to make it easily rendered by Mustache.
   * 1. Parses the distance value to two decimal places
   * 2. Adds a favStore Boolean so we can determine which store is the currently selected store
   * 3. Adds a boolean bopis flag for rendering the curbside pickup SVG
   * 4. Checks if the product is in stock if the inStock param is passed
   * @param {Array} stores - array of store objects from the /search/sku MS
   * @param {Boolean} inStock - True: Only return in stock stores, false: return all stores
   * @returns {Array} stores - returns and array of store objects with data modified
   */
  modifyStoreData(stores, inStock) {
    /*
      [hidden]="({{storeType}} == 10 && !'~~isBBB_US~~') ||
      ({{storeType}} == 40 && !'~~isBABY~~') ||
      ({{storeType}} == 50 && !'~~isCANADA~~')"
    */
    let storeType = this.pwa.session.isBBB_US
      ? 10
      : this.pwa.session.isCANADA
      ? 50
      : 40;
    let bopisSiteId = this.pwa.session.isBBB_US
      ? "BedBathUS"
      : this.pwa.session.isCANADA
      ? "BedBathCanada"
      : "BuyBuyBaby";

    const favoriteStore = this.pwa.college.favoriteStore;

    return stores.otherStores.filter((item) => {
      if (item.storeType == storeType) item.setStore = true;
      try {
        item.favStore =
          stores.favStore && stores.favStore.length > 0
            ? item.storeId == stores.favStore[0].storeId
            : false;
        item.setStore = storeType == item.storeType;
        item.distance = parseFloat(item.distance).toFixed(2);
        item.storeTimings = item.storeTimings.split(",");
        let bopis = item.siteBopus.filter((site) => {
          return site.siteId == bopisSiteId;
        });
        item.bopisFlag = bopis.length > 0 ? parseInt(bopis[0].bopusFlag) : 0;
        item.curbsideFlag = parseInt(item.curbsideFlag) || 0;
        item.isClosest =
          favoriteStore &&
          favoriteStore.storeId === item.storeId &&
          favoriteStore.isClosest;
      } catch (e) {}
      if (inStock) {
        /* Add to cart status = atcStatus
        1.       atcStatus = 0 means available
        2.       atcStatus = 100 or 102 means Not available online
        3.       atcStatus = 1 or 101 means OOS
        4.       atcStatus = 2 means limitedStock
      */
        return item.atcStatus == 0 || item.atcStatus == 2;
      } else {
        return (
          item.storeType == storeType ||
          item.atcStatus == 0 ||
          item.atcStatus == 2
        );
      }
    });
  }
  /**
   * Builds the URL to fetch fulfillment data for individual stores dependant on a sku
   * Fetches the data and returns it
   * @param {String} location - comes from the changeStore.location amp state or whatever the user has entered in the change location form
   * @returns {Object} - Store data returned from the /search/sku MS
   */
  async getStoreData(location) {
    let storeData = undefined;
    try {
      if (!this.modalState)
        throw new Error("Modal State has not been initialized");
      let apiStoreSearch = `${
        this.pwa.session.apiInfo.storeSkuSearch
      }&favStoreId=${this.modalState.changeStore.storeId}&latitude=${
        this.modalState.changeStore.latitude
      }&longitude=${this.modalState.changeStore.longitude}&qty=${
        this.modalState.qty || 1
      }&radius=${this.modalState.storeRadius}&registryId=&searchString=${
        location ||
        this.modalState.changeStore.location ||
        this.modalState.postalCode
      }&skuId=${this.modalState.skuId || ""}`;
      let storeFetch = await fetch(apiStoreSearch);
      storeData = await storeFetch.json();
    } catch (e) {
      console.warn(
        `PickItModal.getStoreData: Unable to get store data. Error: ${e}`
      );
    }
    return storeData;
  }
  /**
   * Performs an shallow merge of the stateObj and object and rerenders the modal
   * Checks that the stateObj exists before performing the merge
   * deliveryModal also extends this method
   * @param {Object} stateObj - this is usually the current state but could be any object we wante to merge
   * @param {Object} obj - the object to merge into the stateObj
   * @param {Boolean} render - true: rerenders the modal, false: does not render the modal
   * @returns
   */
  changeState(stateObj, obj, render) {
    try {
      stateObj = stateObj ? Object.assign(stateObj, obj) : obj;
      if (render) this.render(false);
    } catch (e) {
      console.warn(
        `PickItModal.changeState: Could not change state object. Error: ${e}`
      );
    }
    return stateObj;
  }
  /**
   * Event handler for when the set as my store button is clicked
   * Sets the store as the selected store
   * @param {String} str - JSON string that contains the location for that store {"storeId": "{{storeId}}", "location": "{{postalCode}}" }
   * @returns {Boolean} - if the store was set
   */
  async setAsMyStore(str) {
    try {
      let setStore = JSON.parse(str);
      if (setStore.isClosest) {
        this.pwa.college.updateFavoriteStoreHandler(setStore.storeId);
      }
      let storeId = setStore.storeId;
      let storeState = {
        apiUrl: {
          page: 0,
          sddZipParam: "",
          pageParam: "&start=0&perPage=24",
          storeOnlyParam: `&storeOnlyProducts=true&storeId=${storeId}`,
        },
        cart: {
          storeId: storeId,
        },
        changeStore: {
          csModal: false,
          location: setStore.location,
          nearestStores: null,
          ssModal: false,
          storeId: storeId,
          storeOnly: true,
          sddActive: false,
          sddActiveSearch: false,
        },
        locationDirty: true,
        u: null,
      };
      await this.pwa.amp.ampsSetState(storeState);
      this.closeModal();
    } catch (e) {
      console.warn(`PickItModal.setAsMyStore: Unable to set store`);
    }
    return true;
  }
  /**
   * General event handler for click events on this modal
   * These are for simple functionality that didn't need to have a method
   * @param {CashJs Node} target$ - this is the target node that was clicked
   * deliveryModal also extends this method
   */
  async pickItModalClick(str, target$) {
    if (target$.is(".showAll")) {
      // This allows the show more button to add two at a time
      const endIndex =
        this.storeData.data.otherStores.length >
        this.storeData.data.displayStores.length + 2
          ? this.storeData.data.displayStores.length + 2
          : this.storeData.data.otherStores.length + 1;
      this.storeData.data.displayStores = this.storeData.data.otherStores.slice(
        0,
        endIndex
      );
      this.storeData.data.hideShowMore =
        this.storeData.data.displayStores.length ==
        this.storeData.data.otherStores.length;
      let storeHtml = await this.renderStoreData(this.storeData);
      $("#alStoreStockResults").html(storeHtml);
      if (
        this.storeData.data.otherStores.length ==
        this.storeData.data.displayStores.length
      )
        $("#alStoreStockResults").find(".showAllCont").remove();
    }
    if (target$.is("[data-radius-btn]")) {
      // open radius modal
      let radModal = target$.next();
      if (radModal.hasClass("hide")) {
        radModal.removeClass("hide");
      } else {
        radModal.addClass("hide");
      }
    }
    if (target$.is(".radItm")) {
      let rad = target$.attr("option");
      if (rad) {
        let radiusObj = this.modalState.radiusSelector;
        try {
          this.pwa.amp.ampsSetState({ changeStore: { searchRadius: rad } });
          this.searchRadius = parseInt(rad);
          radiusObj = this.radiusRender();
        } catch (e) {
          console.warn(
            `PickItModal.pickItModalClick: Unable to set search radius. Error: ${e}`
          );
        }
        this.changeState(
          this.modalState,
          { storeRadius: rad, radiusSelector: radiusObj, showClForm: true },
          true
        );
      }
    }
    if (target$.is("[data-current-location]")) {
      let loc = await this.pwa.site.getCurrLocation(target$);
      if (loc) {
        let zip = loc.indexOf("-") > -1 ? loc.slice(0, loc.indexOf("-")) : loc;
        this.changeState(
          this.modalState,
          { currentLocation: zip, showClForm: true, zip: zip },
          true
        );
      }
    }
    if (target$.is("[data-rad-close]")) {
      target$.closest(".pickItMRad").addClass("hide");
    }
  }

  /**
   *
   * @param {CashJs Node} form$ - change location form object. Called from the submit event handler in the appshell
   * @returns
   */
  async pickIt(str, form$) {
    this.pwa.site.formSubmitRouter(form$);
    this.closeModal();
    return true;
  }

  /**
   * Closes and removes the modal from the appshell
   * deliveryModal also extends this method
   */
  closeModal() {
    $(`#${this.modalId}`).remove();
  }

  /**
   * Adds the sliders to the modal. This is only used for the cart error modal
   * @param {Promise[Object,String]} cartSliderFetches[data,template] - this contains the data and the template for the cart slider (recommendataions)
   * deliveryModal also extends this method
   */
  addSlider(cartSliderFetches) {
    let fulfillment = this.modalState.isShipIt
      ? `Similar Products Available for Standard Shipping`
      : this.modalState.isPickIt
      ? `Similar Products Available ${
          this.modalState.storeName
            ? "at " + this.modalState.storeName
            : "for Pickup"
        }`
      : `Similar Products Available for Same Day Delivery`;
    this.pwa.appshell.loadCartModalSlider(
      cartSliderFetches,
      $(`#sliderContainer`),
      {
        ctaType: fulfillment,
        pagination: false,
        removeFirst: true,
        cta: false,
      }
    );
  }

  /**
   *
   * @param {Object} obj {skuId, ctaType}
   * @returns {undefined||Object} - Returns the data from recommendataion container API call
   */
  async fetchSimilarProducts(obj) {
    try {
      let options = {
        scheme: "pdp_fbw",
        currencyCode: "USD",
        country: "US",
        site: this.pwa.session.siteId,
        products: `${this.pwa.session.siteId}_${obj.prodId}`,
        context: `${obj.prodId}`,
        isBrowser: true,
        storeId: obj.storeId || null,
        number: 4,
        web3feo: "abc",
        isGroupby: true,
      };
      const res = await fetch(
        `${
          this.pwa.session.apiInfo.cartSliderApi
        }?${this.pwa.site.objToQueryStr(options)}`
      );
      let resData = await res.json();
      if (res.status !== 200)
        throw new Error(
          `Error fetching ${this.pwa.session.apiInfo.cartSliderApi} container for change store modal`
        );

      resData.title = `Similar Products Available ${
        obj.storeName ? " at " + obj.storeName : ""
      }`;
      resData.ctaType = obj.ctaType;
      return resData;
    } catch (e) {
      console.warn(`PickitModal.fetchSimilarProducts Error: ${e}`);
    }
    return undefined;
  }

  /**
   * Initially this was going to be used for the data-click-handler
   * but decided to use the interaction handler for click and interaction
   * @param {String} sku - currently selected sku
   * @param {CashJs Event Object} target$ - (optional) - if this is a click event, this is the target Object
  //  * @returns {Boolean} - was the modal rendered
   */
  async pickItInteraction(params) {
    let modal = true;
    try {
      if (!params.prodId || !params.skuId) return;
      await this.pwa.util.waitForProp("docObjActive", this.pwa.session);
      this.loadTemplate();
      const cartSliderFetches = [
        this.fetchSimilarProducts({ prodId: params.prodId, ctaType: "pickIt" }),
      ];
      if (!this.pwa.appshell.cartModalTmp) {
        let sliderTmp = this.pwa.appshell.fetchAppshellTmp(
          this.pwa.session.apiInfo.cartSlider,
          `cartSlider`
        );
        cartSliderFetches.push(sliderTmp);
      }
      let obj = {
        skuId: params.skuId,
        prodId: params.prodId,
        storeId: params.storeId,
        isPickIt: true,
        isDeliverId: false,
        isShipIt: false,
        cartError: false,
      };
      modal = await this.render(true, obj, cartSliderFetches);
      // Clear the params if this was PWA load from amp
      try {
        if (!this.pwa.session.docTests.isPLPReg.test(location.pathname)) {
          this.clearInteractionParams();
        }
      } catch (e) {
        console.warn(`pickItModal.pickItInteraction Error: ${e}`);
        modal = false;
      }
    } catch (e) {
      console.warn(`PickItModal.changeStoreClick Error: ${e}`);
      modal = false;
    }
    return modal;
  }

  /**
   * This is called from the ampList post render from the plp product cart list
   * We leave the params until we have a chance to scroll
   * @returns {Boolean}
   */
  scrollPlp() {
    try {
      this.pwa.site.setPlpPositionFromAmp();
      this.clearInteractionParams();
    } catch (e) {
      console.warn(`pickItModal.scrollPlp Error: ${e}`);
    }
    return true;
  }

  /**
   * Clear the interaction params used for transition from AMP to PWA
   */
  clearInteractionParams() {
    let urlObj = new URL(location.href);
    if (urlObj.searchParams.get("type")) {
      for (const param of this.pwa.site.interactionParamsToClear) {
        urlObj.searchParams.delete(param);
      }
      window.history.replaceState(
        null,
        this.pwa.session.docObjActive.shadowDoc.title ||
          this.pwa.session.titleDefault,
        urlObj.href
      );
    }
  }
}

/**
 * This is the appshell based delivery modal
 * This is opened when a user clicks on the zipcode link in the fulfillment  section of PDP
 * Main story: https://bedbathandbeyond.atlassian.net/browse/PP-3166
 * This relies on the following parent class methods
 * -pickItModal.render
 * -pickitModal.fetchSimilarProducts
 * -pickItModal.pickItModalClick - use current location
 *
 */
class DeliveryModal extends PickItModal {
  constructor(pwa) {
    super();
    this.pwa = pwa;
  }
  /**
   *
   * @param {Object} params - called from the site.interactionRouter with params from the link that was clicked
   * @returns {Boolean} - was the modal rendered.
   */
  async initRender(params) {
    this.loadTemplate();
    await this.pwa.util.waitForProp("docObjActive", this.pwa.session);
    this.render(true, params);
    // Clear the params if this was PWA load from amp
    try {
      let urlObj = new URL(location.href);
      if (urlObj.searchParams.get("type")) {
        for (const param of this.pwa.site.interactionParamsToClear) {
          urlObj.searchParams.delete(param);
        }
        window.history.pushState(
          {},
          this.pwa.session.docObjActive.shadowDoc.title ||
            this.pwa.session.titleDefault,
          urlObj.toString()
        );
      }
    } catch (e) {
      console.warn(`pickItModal.pickItInteraction Error: ${e}`);
      return false;
    }
    return true;
  }

  /**
   *
   * @param {Object} params - params from the clicked link or the interaction layer
   * @returns {Object} - modalData used to render the top section of the modal (form)
   */
  async getModalData(params) {
    let modalData = {
      prodId: "",
      skuId: "",
      zip: "",
      deliveryModal: true,
      storeTemplate: false,
      onlyAvailableStores: false,
      modalTemplate: true,
      isShipIt: true,
      zipLabel: "Zip Code",
    };
    Object.assign(modalData, params);
    try {
      const [skuFacets, skuDet] = await Promise.all([
        this.pwa.amp.ampGetState(`skuFacets${modalData.prodId}`),
        this.pwa.pdpDataAbstraction.getSkuDetails(),
      ]);
      delete skuDet.data;
      modalData = Object.assign(modalData, {
        qty: skuFacets.qty || 1,
        scene7RootPath: this.pwa.session.apiInfo.scene7RootUrl,
        DISPLAY_NAME: skuDet.DISPLAY_NAME,
        IMG: {
          imageId: skuDet.PRODUCT_IMG_ARRAY[0].imageId,
          desc: skuDet.PRODUCT_IMG_ARRAY[0].description,
        },
      });
      if (this.pwa.session.isCANADA) modalData.zipLabel = "Postal Code";
    } catch (e) {
      console.warn(`deliveryModal.getModalData Error: ${e}`);
    }
    return modalData;
  }

  /**
   *
   * @param {String} str - string that may be empty
   * @param {CachJs}} form$ - cashJs form node
   * @param {Event} evt - Event object from the click
   * @returns {String} - Rendered delivery method HTML
   */
  async search(str, form$, evt) {
    let skuDet = undefined;
    let storeHtml = "";
    let zipReg = this.pwa.session.isCANADA
      ? /[A-VXY][0-9][A-Z] ?[0-9]?[A-Z]?[0-9]?$/
      : /^[0-9]{5}$/;
    try {
      let zip = this.modalState.zip;
      // setting up initial values
      let pdpDet = {
        data: {
          PRODUCT_DETAILS: {
            sddZipcode: "",
          },
        },
      };

      // This is the inital load and we can use pdpDet
      try {
        /*
          If for some reason the pdp-details hasn't been loaded,
          This could happen if pdp-details is slow and we are using interaction
          params.
        */
        pdpDet = await this.pwa.amp.ampGetState(
          `pdpDet${this.modalState.prodId}`
        );
      } catch (e) {
        console.warn(
          `deliveryModal.search pdpDet getAmpState failed. Error: ${e}`
        );
        pdpDet.data.PRODUCT_DETAILS.SKU_ID = "";
      }

      if (
        this.modalState.skuId == "" ||
        (this.modalState.skuId == pdpDet.data.PRODUCT_DETAILS.SKU_ID &&
          this.modalState.zip == pdpDet.data.PRODUCT_DETAILS.sddZipcode &&
          !form$)
      ) {
        /*
          Only use pdp-details if the data matches.
          Conditions:
          -User has just loaded the page and has not changed the sku
          -Zip has not been changed somewhere else
        */
        skuDet = pdpDet.data.PRODUCT_DETAILS;
      } else {
        /*
          Conditions
          -User submitted the form with a different zip than initial page load
          - Current location was used to update the location
          - Sku has changed from the default sku
        */
        if (form$) {
          /* user submitted form */
          let tmpZip = `${form$.find("#clFormLocale").val()}`;
          if (!zipReg.test(tmpZip)) {
            form$.addClass("formError");
            return false;
          } else {
            form$.removeClass("formError");
          }
          if (tmpZip.trim() !== "" && tmpZip.trim() !== zip.trim()) {
            zip = tmpZip;
          }
        }
        $("#alStoreStockResults").html("Loading...");
        await this.pwa.amp.ampsSetState({
          changeStore: { sddZipcode: zip },
        });
        let listSrc = $(this.pwa.session.docObjActive.shadowBody)
          .find(`#prod2FulfillmentList${this.modalState.prodId}`)
          .attr("src");
        if (!listSrc)
          listSrc = $(this.pwa.session.docObjActive.shadowBody)
            .find(`#cProdFulfillmentList${this.modalState.prodId}`)
            .attr("src");
        if (listSrc) {
          if (/TIMEZONE/.test(listSrc)) {
            let tz = new Date().getTimezoneOffset();
            listSrc = listSrc.replace(/TIMEZONE/, tz);
          }
          listSrc += `&__amp_source_origin=${encodeURIComponent(
            location.origin
          )}`;
          const skuCall = await fetch(listSrc, {
            cache: "force-cache",
            headers: {
              "cache-control": "max-age=120",
            },
          });
          const skuData = await skuCall.json();
          skuDet = skuData.data.PRODUCT_DETAILS;
        }
        if (!skuDet) throw new Error(`Unable to get skuDetails`);
      }

      let storeData = {
        zip: zip,
        prodId: this.modalState.prodId,
        skuId: this.modalState.skuId,
        inStock: skuDet.ONLINE_INVENTORY || false,
        sddEligible: skuDet.sddAvailable || false,
        shipDeliveryMsg: skuDet.shipDeliveryMsg || null,
        sddDeliveryMsg: skuDet.sddDeliveryMsg || null,
        freeShippingMessage: skuDet.freeShippingMessage || null,
        sddShippingFeeMsg: skuDet.sddShippingFeeMsg || null,
        isBackorder: skuDet.isBackorder || false,
        deliveryTemplate: true,
        storeOnly: skuDet.storeOnly || false,
        href: `${location.origin}${location.pathname}`,
        personalized: skuDet.CUSTOMIZATION_OFFERED_FLAG || false,
        hideSdd: !this.pwa.session.features.sdd,
      };
      storeData.OOS =
        !storeData.inStock && !storeData.sddEligible ? true : false;
      if (storeData.OOS) this.renderSimilar(storeData.prodId);
      storeHtml = await this.renderStoreData(storeData);
    } catch (e) {
      console.warn(`deliverModal.search Error: ${e}`);
      storeHtml = `<div class="vp05 gp1 panelAlert">There was an error trying to load the store data. Please try again.</div>`;
    }
    $("#alStoreStockResults").html(storeHtml);
    return storeHtml;
  }

  /**
   * This is called for deliver it and get it shipped atc
   * @param {String} str - Usually empty in this
   * @param {CashJs Node} form$ - form from the modal for add to cart
   * @returns {Boolean}
   */
  async atc(str, form$) {
    this.pwa.site.formSubmitRouter(form$);
    this.closeModal();
    return true;
  }

  /**
   * This loads the recommendataion container
   * It was refactored into a different function since this is not loaded on render
   * in the delivery modal. This is only called if both delivery options are out of stock
   *
   * @param {String} prodId - product id
   */
  async renderSimilar(prodId) {
    const cartSliderFetches = [
      this.fetchSimilarProducts({ prodId: prodId, ctaType: "cart" }),
    ];
    if (!this.pwa.appshell.cartModalTmp) {
      let sliderTmp = this.pwa.appshell.fetchAppshellTmp(
        this.pwa.session.apiInfo.cartSlider,
        `cartSlider`
      );
      cartSliderFetches.push(sliderTmp);
    }
    this.addSlider(cartSliderFetches);
  }
}

class PaginatedSlider {
  constructor(pwa, breakpoint) {
    this.pwa = pwa;
    this.breakpoint = breakpoint || 1101;
    this.visibleProperty = "data-display-count";
    this.cls = {
      containerClass: "dskSliderContainer",
      wrapClass: "dskSliderWrap",
      scrollContClass: "dskSliderScroll",
      cardClass: "dskSliderCard",
    };
  }
  /**
   *
   * @param {CashJsNode} node -- container of slider to render
   * @param {Object} opt -- optional configuration to override defaults
   */
  init(node, opt) {
    let defaults = {
      containerClass: "sliderWrap",
      cardClass: "amp-sacrifice",
      carouselSelector: "amp-carousel",
      scrollContClass: "i-amphtml-carousel-scroll",
      cardsVisible: 5,
    };
    const def = Object.assign(defaults, opt);
    // TODO: remove pagination when the user reduces their browser width from over 1101px to under
    if (window.innerWidth < this.breakpoint) return;
    def.visibleProperty = this.visibleProperty;
    function normalize(node, cls) {
      for (let prop in def) {
        if (cls.hasOwnProperty(prop) && prop.indexOf("Class") > -1) {
          if (node.is(`.${def[prop]}`)) {
            node.addClass(cls[prop]);
            continue;
          }
          node.find(`.${def[prop]}`).addClass(cls[prop]);
        }
      }
      let carousel = node.find(def.carouselSelector);
      carousel.addClass(cls.wrapClass);
      return carousel;
    }
    function addArrows(slider, cards, visible) {
      const arrowMarkup = `
        <div class="sliderControlsCont sHide">
          <div class="leftSliderControl sliderControl" data-direction=0 tabindex="0" role="button">
            <svg class="wi wiCaret deg90 noTap">
              <use xlink:href="#wiCaret"></use>
            </svg>
          </div>
          <div class="rightSliderControl sliderControl active" data-direction=1 tabindex="0" role="button">
            <svg class="wi wiCaret deg270 noTap">
              <use xlink:href="#wiCaret"></use>
            </svg>
          </div>
      </div>`;
      if (
        cards.length > visible &&
        slider.find(".sliderControlCont").length == 0
      )
        slider.after(arrowMarkup);
    }

    try {
      let container = node.find(`.${def.containerClass}`);
      if (container.length == 0)
        container = node.closest(`.${def.containerClass}`);
      if (container.length == 0) return;
      const cls = this.cls;
      const calc = this.calcCardWidth;
      container.each(function () {
        const slider = normalize($(this), cls);
        const cardsVisible =
          slider.attr(def.visibleProperty) || def.cardsVisible;
        slider.attr(def.visibleProperty, cardsVisible);
        // let cards = slider.find(`.${def.cardClass}`);
        let cards = slider.find(`.${def.cardClass}`);
        cards.addClass("sliderCard");
        calc(slider, cards, Number.parseInt(cardsVisible));
        addArrows(slider, cards, Number.parseInt(cardsVisible));
      });
    } catch (e) {
      console.warn(`Error setting up the desktop sliders. Error: ${e}`);
    }
  }
  /**
   *
   * @param {ClickEvent} event - click event from slider arrow controls
   */
  sliderClick(event, opt) {
    // Home Page - "Just For You, Recently Viewed"
    // PLP Page - "Recently Viewed"
    const ampSliderDef = {
      sliderWrapClass: "dskSliderContainer",
      carouselClass: "dskSliderWrap",
      sliderControlClass: "sliderControl",
      scrollContClass: "dskSliderScroll",
      sliderCardClass: "dskSliderCard",
      visibleProperty: "data-display-count",
      visible: 5,
    };
    // Home Page - "Product Carousel Promotion"

    function calcScroll(scrollCont, cards, dir, btn, visible) {
      if (
        scrollCont.length == 0 ||
        cards.length == 0 ||
        !dir ||
        btn.length == 0 ||
        !visible
      )
        return 0;
      const cardWidth = cards.outerWidth();
      const scrollWidth = cardWidth * cards.length;
      const sWidth = cardWidth * visible;
      const contOffset = scrollCont.eq(0)[0].scrollLeft;
      let remaining = 0;
      if (dir == 1) {
        remaining =
          scrollWidth - (contOffset + sWidth) > sWidth
            ? sWidth + contOffset
            : scrollWidth;
      } else {
        remaining =
          contOffset <= sWidth + cardWidth / 2 ? 0 : contOffset - sWidth;
      }
      if (remaining == 0 || remaining * 2 + cardWidth / 2 > scrollWidth) {
        btn.removeClass("active");
      }
      return remaining;
    }
    let def;
    if (opt) {
      def = Object.assign(ampSliderDef, opt);
    } else {
      def = ampSliderDef;
    }

    const control = $(event.target);
    const slider = control.closest(`.${def.sliderWrapClass}`);
    const visible =
      Number.parseInt(
        slider.find(`.${def.carouselClass}`).attr(def.visibleProperty)
      ) || def.visible;
    slider.find(`.${def.sliderControlClass}`).addClass("active");
    // 0=left, 1=right
    let scroll = slider.find(`.${def.scrollContClass}`);
    // on scraped sliders, the amp carousel scroll container doesn't exist on render
    // could create a mutation observer but I think that is overkill
    scroll =
      scroll.length == 0 ? slider.find(".i-amphtml-carousel-scroll") : scroll;
    /* jk 6.28.21 adding sliderCard string literal to the selector below doubled the card count and caused the width calculatsions to be incorrect.
    Removed the string literal. to use a different class pass an options object when initializing:  init(selector, {cardClass: 'sliderCard'}) */
    let scrollVal = calcScroll(
      scroll,
      slider.find(`.${def.sliderCardClass}`),
      control.attr("data-direction"),
      control,
      visible
    );
    scroll[0].scrollLeft = scrollVal;
    return true;
  }
  /**
   *
   * @param {CashJsCollecion} slider - this is the carousel node
   * @param {CashJsCollecion} cards - cards withing the carousel node
   * @param {Number} visible - Number of cards to show at one time
   */
  calcCardWidth(slider, cards, visible) {
    let cWidth = slider.outerWidth();
    let cardWidth = (cWidth / visible).toFixed(2);
    if (cardWidth && !isNaN(cardWidth)) {
      cards.css("width", `${cardWidth}px`);
      slider.width(cardWidth * visible);
      slider.addClass("calculated");
    }
    if (slider.is(".modProductCarousel.viewV5 amp-carousel")) {
      const height = cardWidth * 1.45;
      cards.css("height", `${height}px`);
      cards.find(".sliderCard").css("height", `100%`);
    }
  }
  /**
   *
   * @param {CashJsCollection} node - Parent node to operate on. This is usually the body or amp-list element
   * @param {Object} opt - Options object for scraped sliders
   */
  resize(node, opt) {
    if (window.innerWidth < this.breakpoint) {
      // Remove widths from slidercontainer
      // Remove widths from cards
      // remove calculated class
      node.find(`.${this.cls.cardClass}`).css("width", "");
      node
        .find(`.${this.cls.wrapClass}`)
        .css("width", "")
        .removeClass("calculated");
    } else {
      let sliders = node.find(`.${this.cls.wrapClass}`);
      if (sliders.length == 0) {
        // probably loaded below breakpoint, need to initialize
        // Initialize amp list sliders
        this.init(node);
        if (opt) {
          // Initialize scraped sliders for home and CLP
          this.init(node, opt);
        }
      } else {
        // already been initialized, just need to calculate widths
        const cls = this.cls;
        const vProp = this.visibleProperty;
        const defVis = this.visible;
        const calc = this.calcCardWidth;
        // check for calculated class, if not present, calculate widths on cards and slider container
        sliders.each(function () {
          if (!$(this).hasClass("calculated")) {
            let slider = $(this);
            const visible = slider.attr(vProp) || 5;
            calc(slider, slider.find(`.${cls.cardClass}`), visible);
          }
        });
      }
    }
  }
}

class Ideaboard {
  constructor(pwa) {
    this.pwa = pwa;
  }

  /**
   * Toggles the idea board accordian open or closed
   * @param {Object} event - event for click event
   */
  ideaAccToggle(event) {
    let target$ = $(event.currentTarget);
    target$.parent().toggleClass("ideaAccExpanded");
  }

  /**
   * Add an item to ideaboard.
   * @param {SubmitEvent} submitEvent - Add to ideaboard Form Submission
   * @param {Object} prodObj - Object representing product being added
   *    (for tealium form analytics)
   */
  async ideaAdd(prodObj, submitEvent) {
    if (
      this.pwa.session.features.ideaboardV2 &&
      !this.ideaValidate(submitEvent)
    ) {
      this.pwa.util.stopEvent(submitEvent);
      return;
    }
    try {
      this.pwa.util.stopEvent(submitEvent);

      let form = $(submitEvent.target);

      /* 1. Ensure we have a valid form */
      let valid = this.pwa.util.formValidate(form);
      if (!valid) return;

      const inputs = this.pwa.util.formToObject(form);

      let formType = "createIdeaboard";
      let ideaAddObj = {};
      // 1.5 Either use the new ideaboard structure or continue with old
      if (this.pwa.session.features.ideaboardV2) {
        let addIdeaboardBodyV2 = {};
        let ideaboardApiV2 = "";

        // if ideaboard exist create object for add to ideaboard call
        if (inputs.id) {
          formType = "addIdeaboard";
          addIdeaboardBodyV2 = {
            productId: inputs.productId,
            skuId: /\[/i.test(inputs.skuId) ? "" : inputs.skuId || "",
            productName: inputs.productName,
          };
          ideaboardApiV2 = `${location.origin}/apis/services/ideaboard/v1.0/item?ideaboardId=${inputs.id}`;
        } else {
          // if using createidea board, create object for create ideaboard call
          const tags = form
            .find(".ideaPill.active")
            .map((idx, itm) => $(itm).text())
            .get();
          addIdeaboardBodyV2 = {
            boardName: (inputs.boardName || "").trim(),
            description: (inputs.description || "").trim(),
            isPrivate: inputs.isPrivate == "on" ? true : false,
            item: {
              productId: inputs.productId,
              productName: inputs.productName,
            },
            tags: tags.length ? tags : [],
          };
          ideaboardApiV2 = `${location.origin}/apis/services/ideaboard/v1.0/`;
        }

        // add params to url if signed in or in lower environment
        if (this.pwa.user.ATG_PROFILE_DATA) {
          ideaboardApiV2 += /\?/.test(ideaboardApiV2) ? "&" : "?";
          ideaboardApiV2 += `ownerName=${
            this.pwa.user.ampUserInfo
              ? this.pwa.user.ampUserInfo.data.tealiumUserData.customer_name ||
                ""
              : ""
          }&profileId=${this.pwa.user.ATG_PROFILE_DATA}`;
        }
        if (this.pwa.session.isPreprod || this.pwa.session.isPreview) {
          ideaboardApiV2 += /\?/.test(ideaboardApiV2) ? "&" : "?";
          ideaboardApiV2 += "web3feo";
        }

        ideaAddObj = await fetch(ideaboardApiV2, {
          body: JSON.stringify(addIdeaboardBodyV2),
          credentials: "include",
          method: "POST",
          headers: Object.assign({
            "Content-Type": "application/json",
            "x-bbb-site-id": this.pwa.session.siteId,
          }),
        });
      } else {
        /* 2. New Ideaboard Baseline */
        const addIdeaboardBody = {
          ideaBoardRequest: {
            ideaBoardName: inputs.ideaBoardName || "",
            ideaBoardItems: [
              {
                productId: inputs.productId || "",
                skuId: /\[/i.test(inputs.skuId) ? "" : inputs.skuId || "",
                referenceNumber: "",
                ltlShipMethod: "",
              },
            ],
          },
        };

        /* 3. Add to existing ideaboard - extend form submission object
          Canonical site passes other parameters in some situations,
          Using this syntax in case we need to pass those other params
          in the future.
        */
        if (inputs.ideaBoardId) {
          formType = "addIdeaboard";
          Object.assign(addIdeaboardBody.ideaBoardRequest, {
            ideaBoardId: inputs.ideaBoardId || "",
          });
        }
        const ideaBoardInputJSONString = `ideaBoardInputJSONString=${encodeURIComponent(
          JSON.stringify(addIdeaboardBody)
        )}`;

        // 4. submit add ideaboard
        ideaAddObj = await this.pwa.util.statefulFetch(
          `${location.origin}/apis/stateful/v1.0/ideaboard/item`,
          {
            body: ideaBoardInputJSONString,
            credentials: "include",
            method: "POST",
            headers: Object.assign(
              {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              await this.pwa.user.sessionConfirmationHeadersGetOrSet()
            ),
          }
        );
      }

      // 5. Gather ideaboard info
      //const ideaAddObj = await ideaAddRes.json();

      // 6. Render error message or close
      let ideaboardName = "";
      if (ideaAddObj.serviceStatus == "ERROR") {
        ideaAddObj.error = true;
        return this.ideaModalRender(ideaAddObj);
      } else {
        ideaboardName = this.pwa.session.features.ideaboardV2
          ? inputs.boardName
          : ideaAddObj.data.component.ideaBoardVO.ideaBoardName;
        this.ideaModalClose(ideaboardName);
      }

      if (formType == "createIdeaboard")
        /* User submits create idea board form */
        this.pwa.site.tealiumClickEventEmitter(
          $(`<div data-cta='${this.currentPageType}CreateNewIdeaboard'
          data-attribute='{
            "product_id": ["${prodObj.productId}"],
            "ideaboard_name": "${ideaboardName}",
            "product_price": ["${prodObj.price}"],
            "skuName": "${prodObj.title}"
            ${
              typeof prodObj.position == "number"
                ? `,"product_position_clicked": "${prodObj.position}"`
                : ""
            }
            ${
              prodObj.secIdentifier
                ? `,"secIdentifier": "${prodObj.secIdentifier}"`
                : ""
            }
          }'>
        </div>`)[0]
        );
      else if (formType == "addIdeaboard")
        /* User submits add to idea board form */
        this.pwa.site.tealiumClickEventEmitter(
          $(`<div data-cta='${this.currentPageType}AddToIdeaboard'
          data-attribute='{
            "product_id": ["${prodObj.productId}"],
            "ideaboard_name": "${ideaboardName}",
            "product_price": ["${prodObj.price}"],
            "skuName": "${prodObj.title}"
            ${
              typeof prodObj.position == "number"
                ? `,"product_position_clicked": "${prodObj.position}"`
                : ""
            }
            ${
              prodObj.secIdentifier
                ? `,"secIdentifier": "${prodObj.secIdentifier}"`
                : ""
            }
            ${prodObj.skuId ? `,"product_sku_id": "${prodObj.skuId}"` : ""}

          }'>
        </div>`)[0]
        );
    } catch (ex) {
      console.log(ex);
      this.ideaModalRender({
        error: "Unable to add to ideaboard",
      });
    }
  }

  /**
   * Toggles the idea board checkbox
   * @param {Object} event - event for click event
   */
  ideaCheck(event) {
    let target$ = $(event.target);
    if (target$.is(".ideaDisabled")) return;
    if (target$.prev().length) {
      let checkbox = target$.prev();
      checkbox.prop("checked", !checkbox.prop("checked"));
    }
  }

  /**
   * Updates the character count of textarea for idea board description
   * @param {Object} event - event for input change of textarea
   */
  ideaCountUpdate(event) {
    let target$ = $(event.target);
    try {
      let count = target$.val().length;
      $(".ideaDescCount").text(`${count}/200`);
    } catch (e) {
      console.warn("Could not update count of idea board description");
    }
  }

  /**
   * Displays the "Add to Ideaboard modal"
   * @param {Object} prodObj - ideaboard product form params.
   */
  async ideaModalListBoards(prodObj, paramVal, urlObj) {
    // these params were breaking the product titles from the interaction router
    if (urlObj && /(&reg|&trade)/g.test(urlObj.search)) {
      let newTitle = /title=(.*?)&img=/.exec(urlObj.search);
      if (newTitle)
        prodObj.title = decodeURIComponent(
          newTitle[1].replace(/=/g, "").replace(/\+/g, " ")
        );
    }

    // stop including full url in add to ideaboard param routing, should only have a scene url except for personalized products
    if (!/b3h2\.scene7\.com/.test(prodObj.img))
      prodObj.scene7Url = this.pwa.session.apiInfo.scene7RootUrl + "/";

    /* this.currentPageType is used to determine which
    Tealium ideaboard analytics functions to call */
    let pageType = "";
    let pageMatch = /\/store\/([^/]*)?/i.exec(location.pathname);
    if (pageMatch) pageType = pageMatch[1];

    if (pageType == "product") {
      this.currentPageType = "pdp";
    } else if (/brand|category|s/.test(pageType)) {
      this.currentPageType = "plp";
    } else {
      this.currentPageType = "home";
    }

    // prepare to render cart results in this.ideaModalRender
    this.pwa.util.scriptAddMustache();
    let ideaboardsObj = {};
    let anonMaxItems;
    // 2. fetch ideaboards
    if (this.pwa.session.features.ideaboardV2) {
      let ideaboardsObjResponse = await fetch(
        `${location.origin}/apis/services/ideaboard/v1.0/?${
          this.pwa.user.ATG_PROFILE_DATA
            ? `profileId=${this.pwa.user.ATG_PROFILE_DATA}&`
            : ""
        }orderBy=creationDate&productId=${prodObj.productId}&ownerName=${
          this.pwa.user.ampUserInfo
            ? this.pwa.user.ampUserInfo.data.tealiumUserData.customer_name || ""
            : ""
        }${
          this.pwa.session.isPreprod || this.pwa.session.isPreview
            ? `&web3feo`
            : ""
        }`,
        {
          credentials: "include",
          method: "GET",
          headers: Object.assign({
            "Content-Type": "application/json",
            "x-bbb-site-id": this.pwa.session.siteId,
          }),
        }
      );

      ideaboardsObj = await ideaboardsObjResponse.json();

      // 3. Gather ideaboard(s) info
      const [user, mustacheIsLoaded] = await Promise.all([
        this.pwa.amp.ampGetState("user"),
        this.pwa.util.waitForProp("Mustache"),
      ]);

      ideaboardsObj.prodObj = prodObj;
      user.data.loginStatus = parseInt(user.data.loginStatus) || 0;
      ideaboardsObj.user = user;

      // Enable List View
      ideaboardsObj.listIdeaboardsV2 = true;

      // TODO: remove this and add data-modal-open attribute to all add to ideaboard buttons when ideaboardV2 is approved
      $("body").addClass("modalOpen");

      if (ideaboardsObj.user.data.loginStatus == 0) {
        ideaboardsObj.disablePriv = true;
      }

      ideaboardsObj.emptyBoardImg = this.pwa.session.isBABY
        ? "babytitleimage"
        : this.pwa.session.isHARMON
        ? "harmontitleimage"
        : "emptyTileIcon";

      /* Anonymous users can only create one ideaboard.
      Switch to "Create Idea Board" view. */
      try {
        anonMaxItems =
          ideaboardsObj.user.data.loginStatus == 0 &&
          ideaboardsObj.data[0].itemCount == 4;
      } catch (ex) {}
    } else {
      ideaboardsObj = await this.pwa.util.statefulFetch(
        `${
          location.origin
        }/apis/stateful/v1.0/customers/customer-id/idea-boards?ignoreItemDetails=${
          prodObj.ignoreItemDetails || "false"
        }&productId=${prodObj.productId}`,
        {
          credentials: "include",
          method: "GET",
          headers: Object.assign(
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );

      // 3. Gather ideaboard(s) info
      const [user, mustacheIsLoaded] = await Promise.all([
        this.pwa.amp.ampGetState("user"),
        this.pwa.util.waitForProp("Mustache"),
      ]);

      ideaboardsObj.prodObj = prodObj;
      user.data.loginStatus = parseInt(user.data.loginStatus) || 0;
      ideaboardsObj.user = user;

      // Enable List View
      ideaboardsObj.listIdeaboards = true;

      /* Anonymous users can only create one ideaboard.
      Switch to "Create Idea Board" view. */
      try {
        anonMaxItems =
          ideaboardsObj.user.data.loginStatus == 0 &&
          ideaboardsObj.data.atgResponse[0].itemCount == 4;
      } catch (ex) {}
    }

    if (anonMaxItems) {
      ideaboardsObj.error = true;
      ideaboardsObj.errorAnonItemsMaxExceeded = true;
    }

    if (ideaboardsObj.serviceStatus == "ERROR") {
      ideaboardsObj.error = true;
      ideaboardsObj.errorApiFailed = true;
    }
    this.ideaboardsObj = ideaboardsObj;
    this.ideaModalRender(ideaboardsObj);

    // Fire tealium ideaboard modal load event.
    // Get prod info from DOM for Tealium Load event
    // const pageProdInfo = await this.ideaProdInfoFromDom();
    // Object.assign(prodObj, pageProdInfo);
  }

  /**
   * Renders the ideaboard modal in one of these states:
   *  1. Anonymous - Ideaboard Creation instructions
   *  2. Authenticated - List of existing ideaboards
   *  3. Anonymous/Authenticated - New Ideaboard form
   *  4. Error State - Anonymous && tried to create more than one ideaboard
   *  5. Error State - Anonymous && tried to add more than 4 items to ideaboard
   *  6. Error State - Item already exists in ideaboard
   * @param {Object} ideaboardsObj - Rendering data
   */
  ideaModalRender(ideaboardsObj) {
    // remove previous modal
    $("#modalIdeaWrap").remove();

    /* 1. Render ideaboard modal on appshell */
    let modalIdeaTemplateElem = $("#modalIdeaTemplate");
    let modalIdeaTemplate = "";
    Array.from(modalIdeaTemplateElem[0].content.children).forEach(
      (child) => (modalIdeaTemplate += child.outerHTML)
    );

    let modalIdea = Mustache.render(modalIdeaTemplate, ideaboardsObj);
    $("body").append(modalIdea);

    /* 2. Event Listeners */
    let modalIdeaWrap = $("#modalIdeaWrap");
    let close = modalIdeaWrap.find(".modalCloseJs");
    if (close.length > 0) close[0].focus();

    // 2a. Re-render ideaboard modal with New Ideaboard form (Create new idea board)
    modalIdeaWrap.find(".ideaCreateBoardJs").on(
      "click",
      function () {
        let ideaboardsObj = this.ideaboardsObj;
        if (!ideaboardsObj) return;

        // Switch to "Create Idea Board" view.
        if (this.pwa.session.features.ideaboardV2) {
          ideaboardsObj.listIdeaboardsV2 = false;
          ideaboardsObj.createIdeaboardV2 = true;

          if (
            ideaboardsObj.data &&
            ideaboardsObj.data.length &&
            ideaboardsObj.user.data.loginStatus == 0
          ) {
            /* Anonymous users can only create one ideaboard.
            Switch to "Create Idea Board" view. */
            ideaboardsObj.error = true;
            ideaboardsObj.errorAnonIdeaMaxExceeded = true;
          }
        } else {
          ideaboardsObj.listIdeaboards = false;
          ideaboardsObj.createIdeaboard = true;

          if (
            ideaboardsObj.data.atgResponse &&
            ideaboardsObj.data.atgResponse.length &&
            ideaboardsObj.user.data.loginStatus == 0
          ) {
            /* Anonymous users can only create one ideaboard.
            Switch to "Create Idea Board" view. */
            ideaboardsObj.error = true;
            ideaboardsObj.errorAnonIdeaMaxExceeded = true;
          }
        }

        this.ideaModalRender(ideaboardsObj);
        let ideaProdAddName = $("#ideaProdAddName, #ideaProdAddNameV2")[0];
        if (ideaProdAddName) ideaProdAddName.focus();
        if (this.pwa.session.features.ideaboardV2) {
          $(".ideaProdPrivLabel").on("click", this.ideaCheck);
          $(".ideaAccordHead").on("click", this.ideaAccToggle);
          $(".ideaAccPanel").on("click", this.ideaPillToggle);
          $("#ideaProdDesc").on("input", this.ideaCountUpdate);
          $("#ideaProdAddNameV2").on("input", this.ideaPreventChars);
        }
      }.bind(this)
    );

    // 2b. Close ideaboard modal
    // modalIdeaWrap
    //   .find(".modalCloseJs")
    //   .on("click", () => $("#modalIdeaWrap").remove());

    // 2c. Ideaboard form submission & close
    modalIdeaWrap
      .find(".ideaProdAdd")
      .on("submit", this.ideaAdd.bind(this, ideaboardsObj.prodObj));

    modalIdeaWrap.find("input").on("keyup", (event) => {
      const input = event.target;
      const validity = this.pwa.util.formValidateInput(input.validity);
      input.setAttribute("validity", validity);

      const form = $(event.target.form);
      form.addClass("formDirty");
    });

    if (ideaboardsObj.listIdeaboards)
      this.ideaModalLoadEvent(ideaboardsObj.prodObj);
  }

  async ideaModalLoadEvent(prodObj) {
    if (!window.triggerLoadEvent) return;

    try {
      /* User clicks on the Product card heart icon */
      this.pwa.site.tealiumClickEventEmitter(
        $(`<div data-cta='${this.currentPageType}AddToIdeaboardSnowplow'
            data-attribute='{
              "product_id": ["${prodObj.productId}"],
              "product_price": ["${prodObj.price}"]
              ${
                typeof prodObj.position == "number"
                  ? `,"product_position_clicked": "${prodObj.position}"`
                  : ""
              }
              ${
                prodObj.secIdentifier
                  ? `,"secIdentifier": "${prodObj.secIdentifier}"`
                  : ""
              }
            }'>
          </div>`)[0]
      );

      let ideaModalLoadEvent = {
        boosted_search_engine: "solr_s1", // XXX this will probably have to change to GB at some point?
        call_to_actiontype: "ideaboard add modal",
        channel: "My Account",
        content_pagetype: "",
        crossell_page: "",
        crossell_product: "",
        facet_order: "",
        facets_applied: "",
        feo_site_indicator: "AMP Pages",
        ideaboard_name: "",
        internal_search_term: "",
        landingPageUrl: document.location.href, // Current Page URL
        navigation_path: "My Account",
        page_function: "My Account",
        page_name: "ideaboard add modal",
        page_referrer_url: "",
        page_type: "My Account",
        pagename_breadcrumb: "My Account >Add to Idea Board",
        product_finding_method: "",
        product_id: [prodObj.productId],
        product_pagetype: "",
        product_position_clicked: "",
        product_price: [prodObj.price], // Dynamic
        search_engine_used: "Solr",
        search_words_applied: "",
        session_referrer: "",
        session_referrer_domain: "",
        sheer_id_indicator: "Not Verified",
        site_channel: "mobile", // XXX this will changed depending on device, once we support desktop
        sort_value: "",
        subnavigation_path: "My Account",
        user_type: "non registered user",
      };

      window.triggerLoadEvent(
        `dataLayer=${encodeURIComponent(JSON.stringify(ideaModalLoadEvent))}`
      );
    } catch (error) {
      console.warn(`Unable to send ideaModalLoad Event. Error: ${e}`);
    }
  }

  /**
   * After a user has added a product to an ideaboard,
   * closes ideaboard modal and shows confirmation message.
   * @param {Object} ideaboardName - the name of the ideaboard that was added
   */
  async ideaModalClose(ideaboardName) {
    // 1. Remove Ideaboard modal
    $("#modalIdeaWrap").remove();

    let ideaboardMsg = "";
    if (this.pwa.session.features.ideaboardV2) {
      // TODO render message like added to shopping list
      ideaboardMsg = `Item is successfully added to ${ideaboardName}`;
    } else {
      ideaboardMsg = `The item has been successfully added to ${
        ideaboardName ? ideaboardName : "the ideaboard"
      }.`;
    }
    // 2. Render confirmation message
    let msgIdeaboardAdded = `
    <button id="msgIdeaboardAdded" class="msg msgIdeaboardAdded active msgCloseJs">
      ${ideaboardMsg}
    </button>`;
    $("body").append(msgIdeaboardAdded);

    // 3. Event: confirmation message tap - closing animation & remove from DOM.
    $(".msgCloseJs").on("click", () => {
      let msgIdeaboardAdded = $("#msgIdeaboardAdded");
      msgIdeaboardAdded.removeClass("active");
      setTimeout(
        function (msgIdeaboardAdded) {
          msgIdeaboardAdded.remove();
        }.bind(this, msgIdeaboardAdded),
        500
      );
    });

    // 4. Close confirmation message for user after 2 seconds
    setTimeout(() => {
      $(".msgCloseJs").trigger("click");
    }, 2000);
  }

  /**
   * Toggles the idea board optional tag pills and updates the count
   * @param {Object} event - event for click event
   */
  ideaPillToggle(event) {
    let target$ = $(event.target);
    target$.toggleClass("active");
    $(".createIdeaAdded").text($(".ideaPill.active").length);
  }

  /**
   * prevents users from entering special characters
   * @param {Object} event - event for click event
   */
  ideaPreventChars(event) {
    let regex = /[^a-zA-Z0-9\-'.$\s]/gi,
      cursor = this.selectionStart,
      value = event.target.value;
    if (regex.test(value)) {
      $(event.target).val(value.replace(regex, ""));
      cursor--;
    }
    // prevents user from entering a space as the first character or more than one space at a time
    if (cursor > 0 && value[cursor - 1] == " ") {
      if (cursor == 1) {
        $(event.target).val("");
        cursor--;
      } else if (value[cursor - 2] == " ") {
        cursor--;
        $(event.target).val(value.slice(0, cursor));
      }
    }
    this.setSelectionRange(cursor, cursor);
  }

  /**
   * Scrape user-selected ideaboard modal information from page.
   * For now - Temp until all pdp have skuId and img as part of form
   * Later - limit to price for Tealium analtytics.
   */
  async ideaProdInfoFromDom() {
    const docObjActive = await this.pwa.util.waitForProp(
      "docObjActive",
      this.pwa.session
    );
    const activeBody = $(
      await this.pwa.util.waitForProp("shadowBody", docObjActive)
    );
    await this.pwa.util.waitForElement(".trackIsPrice", activeBody[0]);
    const pageProdInfo = {
      price: activeBody.find(".trackIsPrice").text().trim(),
    };
    return pageProdInfo;
  }

  /**
   * cheacks the validity of the create ideaboard form
   * @param {Object} event - event for click event
   */
  ideaValidate(event) {
    let input = $("#ideaProdAddNameV2");
    if (!input.length || input.val()) {
      return true;
    } else {
      $("#ideaInputCont").addClass("ideaInvalid");
      return false;
    }
  }
}

/**
 * Custom Mobile Optimize document loader
 */
class Mo {
  /**
   * Mobile optimize specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    this.pwa = pwa;
  }

  /**
   * Loads the MO document without the PWA
   *
   * @param {Pwa} pwa - document loader
   * @param {Object} ampDocObj - object with document and document host references
   * @param {URL} urlObj - url to fetch
   * @returns {Promise} - Promise that resolves when moLoad page is loaded
   */
  async moLoad(ampDocObj, urlObj) {
    if (this.pwa.session.isDebug) debugger;
    // remove PWA overrides for testing
    urlObj.searchParams.delete("wmPwa");
    document.cookie =
      "wmPwa=true; max-age=0; path=/; secure; expires=Thu, 01 Jan 1970 00:00:01 GMT";

    // if page is in AMP scope, but excluded because it has a MO queryParam, add wmSkipPwa.
    if (
      this.pwa.session.docTests.isAmpReg.test(
        `${urlObj.pathname}${urlObj.searchParams}`
      )
    )
      urlObj.searchParams.set("wmSkipPwa", 1);

    location.href = urlObj.href;
    console.log("loading MO");

    return true;

    // ... or ...
    // fetch doc
    // insert mo script
    // iframeContent = pwa.util.parseDom(text)
    //
    // var doc = document.getElementById(iframeId).contentWindow.document;
    // doc.open();
    // doc.write(iframeContent);
    // doc.close();
  }
}

/**
 * Nav Sidebar related functions
 */
class NavPanel {
  /**
   * Mobile optimize specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    this.pwa = pwa;
    this.registeredDocs = [];

    const botFullMenuTemplate = $("#botFullMenuTemplate")[0];
    this.botFullMenuTemplate = botFullMenuTemplate
      ? botFullMenuTemplate.innerHTML
      : "";
  }

  _navClose(ampBody$) {
    this.pwa.amp.ampsSetState({
      u: { nav: "" },
      navState: {
        activeDskNav: "",
        flyoutMenu: "",
        isCatNav: false,
        isTopNav: false,
        nav1Header: "",
        nav1Obj: null,
        nav2Header: "",
        nav2Obj: null,
      },
    });
    ampBody$.removeClass("modalOpen");
    $("body").removeClass("modalOpen");
  }

  _navMouseleave(ampBody$, e) {
    if (
      // Give user 2 sec to move mouse from category bar to flyout
      this.dskNavCategoryDebounce ||
      !ampBody$.hasClass("modalOpen") ||
      !/modalOpen/.test(ampBody$[0].className) ||
      // Don't close nav flyouts if moving mouse from one nav component to another (ex: categoryBar to navWrap)
      $(e.relatedTarget).closest("[data-nav-mouseleave]").length
    ) {
      return;
    }

    this._navClose(ampBody$);
  }

  // prefetch navigation data for JS bots and prerender all the nav links
  async botNavRender(ampList$) {
    this.pwa.util.scriptAddMustache();
    let [navV2Data, waitForMustache] = await Promise.all([
      this.pwa.amp.ampGetState("navV2Data"),
      this.pwa.util.waitForProp("Mustache"),
    ]);

    let botNav$ = $(Mustache.render(this.botFullMenuTemplate, navV2Data));
    // Remove L3 links
    botNav$.find("a").each((i, e) => {
      if (/\/category\/([a-z\-]+\/){3}[0-9]+\/?$/i.test(e.href)) {
        $(e).remove();
      }
    });
    ampList$.after(botNav$);
  }

  // give user 1 second to move from category scrollbar to desktop menu panel before closing panel on mouseleave
  navDskCategoryBtnClickDebounce(target$) {
    if (
      this.pwa.desktop.isDesktop &&
      target$ &&
      target$.attr("data-test") == "categoriesLink" &&
      !this.dskNavCategoryDebounce
    ) {
      this.dskNavCategoryDebounce = true;
      setTimeout(
        function () {
          this.dskNavCategoryDebounce = false;
        }.bind(this),
        1000
      );
      return true;
    } else {
      return false;
    }
  }

  /**
   * Enable drag-to-scroll on categories bar if categories extend beyond window
   * Initially called from ampListPostRender
   * @param {CashJsCollection} ampList$ - categories nav bar amp-list
   */
  navDskCategoryDragScrollRegister(ampList$) {
    if (
      !ampList$ ||
      !ampList$.length ||
      ampList$.attr("data-nav-dragscroll-registered")
    )
      return;
    const navPillsBar = ampList$.find(".navPillsBar");
    const body = ampList$.closest("body")[0];

    // Dont add drag event listeners (or remove them) if all the pills fit and scrolling isn't needed.
    if (
      navPillsBar.find("a").closest("div").innerWidth() <=
      navPillsBar.innerWidth()
    ) {
      navPillsBar
        .removeClass("grab grabbing")
        .off("mousedown")
        .off("mouseup")
        .find(".navPill")
        .off("click", handlePillClick);
      $(body).removeClass("grab grabbing").off("mousedown").off("mouseup");
      return;
    }

    const simpleThrottle = this.pwa.util.simpleThrottle;
    let isDown = false,
      isMove = false,
      startX,
      scrollLeft;

    navPillsBar.addClass("grab");

    // Don't use jquery in event handlers for best performance

    function handleMouseDown(e) {
      isMove = false;
      isDown = true;

      // Need to add listeners to the window so that drag-scrolling still functions if the cursor leaves the categories bar AND the WINDOW ITSELF while dragging
      window.addEventListener("mousemove", simpleThrottle(handleMouseMove, 25));
      window.addEventListener("mouseup", handleMouseUp);

      body.classList.add("noTxtSelect");

      navPillsBar[0].classList.add("grabbing");

      startX = e.pageX - navPillsBar[0].offsetLeft;
      scrollLeft = navPillsBar[0].scrollLeft;
    }

    function handleMouseMove(e) {
      if (!isDown) return;

      const x = e.pageX - navPillsBar[0].offsetLeft;
      const walk = x - startX;
      // Give 3px of tolerance in case mouse moves slightly during click on a pill
      if (!/navPill/.test(e.path[0].className) || Math.abs(walk) > 3) {
        isMove = true;
      } else {
        return;
      }
      e.preventDefault();
      navPillsBar[0].scrollLeft = scrollLeft - walk;
    }

    function handleMouseUp(e) {
      isDown = false;

      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener(
        "mousemove",
        simpleThrottle(handleMouseMove, 25)
      );

      navPillsBar[0].classList.remove("grabbing");
      body.classList.remove("noTxtSelect");
    }

    // Need to prevent sidebar menu from opening if a pill was grabbed and dragged.
    // If no dragging occurred, just open sidebar as normal
    function handlePillClick(e) {
      if (isMove) e.preventDefault();
    }

    navPillsBar
      .on("mousedown", handleMouseDown)
      .find(".navPill")
      .on("click", handlePillClick);

    ampList$.attr("data-nav-dragscroll-registered", "1");
  }

  // Add mouseleave event listeners to nav components and control whether the flyout menu closes or not.
  navMouseleaveListenerRegister(ampBody$) {
    if (ampBody$.attr("data-nav-mouseleave-registered")) return;
    const navMouseleaveBound = this._navMouseleave.bind(this, ampBody$);
    ampBody$
      .find("[data-nav-mouseleave]")
      .each((i, e) => e.addEventListener("mouseleave", navMouseleaveBound));
    ampBody$.attr("data-nav-mouseleave-registered", "1");
  }

  // TODO - remove shim once all Pages have navV4 (after 11.1.21)
  // navV2Shim(ampDoc$, ampBody$) {
  //   if (
  //     this.pwa.session.features.siteNavV2 &&
  //     ampBody$.find("#navCategoriesBar").length &&
  //     !ampBody$.hasClass("navV4")
  //   ) {
  //     ampBody$.addClass("navV2");
  //     const headHeight = this.pwa.session.isCANADA ? 148 : 180;
  //     // Append navV2 css if navV2 is enabled
  //     // Doing this in PWAMP to save css chars, because navV2 is currently PWA only
  //     const navV2Css = `
  //       body.navV2 {
  //         --headHeight: ${headHeight}px;
  //       }
  //       .navPillsBar {
  //         border-bottom: 1px solid #e7e7e7;
  //         overflow-x: scroll;
  //         scrollbar-width: none; /*Firefox*/
  //         -ms-overflow-style: none; /* pre-chromium edge */
  //       }
  //       .navV2 #navWrap {
  //         max-width: 270px;
  //       }
  //       .navV2 .overlay.catNav {
  //         top: 100%;
  //       }
  //       .navPillsBar > div {
  //         margin: auto;
  //         width: max-content;
  //       }
  //       .navPillsBar::-webkit-scrollbar {
  //         display: none;
  //       }
  //       .navPillsBar:after {
  //         background: linear-gradient(to right, #ffffff00, #fff 60%);
  //         content: '';
  //         display: block;
  //         height: calc(100% - 1px);
  //         position: absolute;
  //         top:0;
  //         right:0;
  //         width:28px;
  //       }
  //       .navPill {
  //         min-height: 0;
  //         height: 30px;
  //         margin: 9px 4px;
  //         padding: 4px 11px 9px 12px;
  //         border: solid 1px #f1f2f1;
  //         border-radius: 15px;
  //         cursor: pointer;
  //       }
  //       .navPill.active {
  //         background-color: var(--btnLinkColor);
  //       }
  //       .nav .wi.wiCaret.deg0 {
  //         transform: none;
  //       }
  //       .navV2 .nav button:not(.btnPrimary) {
  //         color: var(--btnLinkColor);
  //         border-bottom: 1px solid #efefef;
  //         cursor: pointer;
  //       }
  //       .navV2 .itemCont,
  //       .navV2 .nav1Col {
  //         margin: 0 0 0 16px;
  //         padding-right: 16px;
  //       }
  //       .navV2 .nav1Btn {
  //         font: var(--menuHeader);
  //         letter-spacing: -0.5px;
  //         line-height: 19px;
  //         min-height: 50px;
  //         text-decoration: none;
  //         text-transform: var(--txtTransform);
  //         padding: 0;
  //       }
  //       .navV2 #nav1List .nav1Btn {
  //         font: ~~font-menu-1~~;
  //         letter-spacing: -0.5px;
  //         line-height: 19px;
  //         min-height: 50px;
  //         text-align: left;
  //         text-decoration: none;
  //         text-transform: var(--txtTransform);
  //         white-space: nowrap;
  //         padding: 0;
  //       }
  //       .navV2 #nav1List .nav1Btn {
  //         color: var(--menuHeaderColor);
  //       }
  //       .navV2 .nav1Col .wi {
  //         vertical-align: middle;
  //         max-height: 19px;
  //       }
  //       .navV2 .menuHeader {
  //         margin-bottom: 0;
  //       }
  //       .navV2 .nav .menuHeader .wiCaret.deg0 {
  //         transform: none;
  //       }
  //       .navV2 .navItem {
  //         padding: 12px 0;
  //       }
  //       .navV2 .registryCont {
  //         margin: 0 8px 20px 0px;
  //       }
  //       /* .registryBtn specificity is high
  //         because nav button reset also has high specificity */
  //       .navV2 .registryCont .registryBtn.registryBtn,
  //       .navV2 button.navBack.navBack {
  //         border-bottom: none;
  //       }
  //       .navBorderBtm {
  //         border-bottom: 1px solid #efefef;
  //       }
  //       .nav1Col > .topLvlItm {
  //         padding: 16px 0;
  //         min-height: fit-content;
  //         border-bottom: 1px solid #efefef;
  //         line-height: normal;
  //         order: 2;
  //       }
  //       .navSubItm {
  //         order: 2;
  //       }
  //       .placeFirst.placeFirst {
  //         order: 1;
  //       }
  //       .menuCol > div .subItm:last-of-type {
  //         margin-bottom: 1.5rem;
  //       }
  //       .catNav .nav {
  //         height: calc(100vh - var(--headHeight));
  //       }
  //       .catNav #navLayer1List {
  //         margin-top: 0;
  //       }
  //       #navWrap.catNav,
  //       .catNav #nav1List,
  //       .catNav .nav1Col {
  //         height: calc(100vh - var(--headHeight) - var(--pencilBannerHeight))
  //       }

  //       body[class*='hidePencil'] #navWrap.catNav,
  //       body[class*='hidePencil'] .catNav #nav1List,
  //       body[class*='hidePencil'] .catNav .nav1Col {
  //         height: calc(100vh - var(--headHeight));
  //       }
  //       .menuContent {
  //         margin-top: -0.75rem;
  //       }
  //       .registryNav .menuContent {
  //         margin-top: -3.75rem;
  //       }
  //     `;
  //     ampDoc$.find("style[amp-custom]").each((i, ampCustomStyle) => {
  //       ampCustomStyle.innerHTML += navV2Css;
  //     });

  //     // Remove unused nav components
  //     ampBody$.find("[data-feature-hide='siteNavV2']").remove();
  //     ampBody$.find(".navV1").removeClass("navV1");
  //   }
  // }
}

class Personalize {
  constructor(pwa) {
    this.pwa = pwa;
    this.personalizedSku = [];
    this.messageListenerAdded = false;
  }

  // adds message listener to get postmessage from personalize iframe modal
  addMessageListener() {
    this.messageListenerAdded = true;
    window.addEventListener("message", (evt) => {
      if (location.origin === evt.origin && /personalizeModal/.test(evt.data)) {
        try {
          let dataObj = JSON.parse(evt.data);
          if (dataObj.action === "close") {
            this.closeModal();
          } else if (dataObj.action === "saveData") {
            this.venderPersonalizeDataGet(dataObj);
            this.closeModal();
          } else if (dataObj.action === "personalizeReady") {
            $(this.pwa.session.docObjActive.shadowBody)
              .find("#vendorIframeModal")
              .attr("data-personalize-ready", true);
          } else if (dataObj.action === "error") {
            this.closeModal();
            this.reportError();
          }
        } catch (e) {
          console.warn(
            `Personalize: personalizeModal event listener: could not decode data. Error: ${e}`
          );
          this.closeModal();
        }
      }
      // design direct uses window.top instead of window.parent which means we have to send the message back down for it to be processed correctly,
      // gives us the opportunity to close the modal here though
      if ("https://bbb.snowmachine.me" === evt.origin) {
        this.sendMessage(evt.data, $(this.pwa.session.docObjActive.shadowBody));
        if (evt.data.name === "customizationCancel") {
          this.closeModal();
        }
      }
    });
  }

  /**
   * adds the vendor iframe modal to the body on load to load the vendor javascript files faster, also adds personalized class to the amplist if item has been personalized
   * @param {CashJsCollection} ampList - should be the prodfulfillmentlist2 amplist from amplistpostrender
   */
  async addVendorModal(ampList) {
    let vendorModal = ampList.closest("body").find("#vendorIframeModal");
    let prodId = this.pwa.site.prodIdGet(new URL(location.href));
    let pdpDetails;
    if (!vendorModal.length) {
      pdpDetails = await this.pwa.amp.ampGetState(`pdpDet${prodId}`);
      if (pdpDetails.data.PRODUCT_DETAILS.CUSTOMIZATION_OFFERED_FLAG) {
        // clear old data and check for data in session storage
        this.personalizedSku = [];
        let vendorId = pdpDetails.data.PRODUCT_DETAILS.VENDOR_ID[0];
        for (const skuItm of pdpDetails.data.SKU_DETAILS) {
          let skuId = skuItm.SKU_ID;
          let data = sessionStorage.getItem(`personalized-${skuId}`);
          if (data) {
            let personalizeObj = {
              sku: skuId,
              refnum: data,
              vendorId: vendorId,
            };
            await this.venderPersonalizeDataGet(personalizeObj);
          }
        }

        // render the modal
        this.personalizeModalRender(
          prodId,
          pdpDetails.data.PRODUCT_DETAILS.SKU_ID
        );
      }
    }

    pdpDetails = await this.pwa.pdpDataAbstraction.getSkuDetails(prodId);
    if (this.personalizedSku[pdpDetails.SKU_ID]) {
      ampList.addClass("personalized");
      ampList.closest("body").find("#stickyCtaList").addClass("personalized");
    } else {
      ampList.removeClass("personalized");
      ampList
        .closest("body")
        .find("#stickyCtaList")
        .removeClass("personalized");
    }
  }

  async ampListPostRenderPersonalize(ampList) {
    // this is required to update the price in the sticky nav since the list makes an external call to pdp-details to get the data it uses ie. skuDet{{PRODUCT_ID}}
    if (ampList.is("#stickyCtaList") && ampList.is(".personalized")) {
      let prodId = this.pwa.site.prodIdGet(new URL(location.href));
      let pdpDetails = await this.pwa.pdpDataAbstraction.getSkuDetails(prodId);
      ampList
        .find(".stickyPrice")
        .html(this.personalizedSku[pdpDetails.SKU_ID]["final-price"]);
    }
  }

  // closes the personalize Iframe modal
  closeModal() {
    $(this.pwa.session.docObjActive.shadowBody)
      .find("#vendorIframeModal")
      .removeClass("active");
    $("body").removeClass("modalOpen");
  }

  /**
   * either adds or removes the personalized image from the given array according to the accumulator, 1 for adding, -1 for deletion
   * @param {Array} ary - image array that needs from pdpdetails
   * @param {int} acc - accumulator for fixing the array indices
   * @param {string} skuId - sku id
   */
  imageArrayUpdate(ary, acc, skuId) {
    let data = this.personalizedSku[skuId];
    if (acc === 1) {
      let img = {
        description: (data.images[0].description || "").replace(/"/g, "&quot;"),
        idx: -1,
        personalizeUrl:
          data["imageURL_hires"] || data.images[0].previews[0].url,
        personalizeUrlSm: data.images[0].previews[3]
          ? data.images[0].previews[data.images[0].previews.length - 1].url
          : data["imageURL_hires"] || data.images[0].previews[0].url,
        type: "image",
      };
      ary.unshift(img);
    } else {
      ary = ary.slice(1);
    }

    ary.forEach((img) => {
      img.idx += acc;
    });

    return ary;
  }

  // opens the personalize iframe modal, waits for flag from the iframe to tell it to proceed with the postmessage call
  async openModal(skuId) {
    let ampBody$ = $(this.pwa.session.docObjActive.shadowBody);
    // check if the current ampBody is pdp, need to wait for this if coming from param router
    if (ampBody$.hasClass("pdp")) {
      // if the vendorIframe hasnt been added yet, wait for it to be added and have correct property
      let vendorModal = ampBody$.find("#vendorIframeModal");
      if (!vendorModal.length || !vendorModal.attr("data-personalize-ready")) {
        await this.pwa.util.waitForElement(
          "#vendorIframeModal[data-personalize-ready]",
          ampBody$[0]
        );
      }
      // TODO: add data-modal-open to pdp add to cart/personalize submit button and data-modal-close to post atc modal
      $("body").addClass("modalOpen");
      ampBody$.find("#vendorIframeModal").addClass("active");
      let msg = {
        personalizeCallId: "personalizeParentCall",
        action: "updateVendorModal",
        skuId,
        refnum: this.personalizedSku[skuId]
          ? this.personalizedSku[skuId].refnum
          : "",
      };
      this.sendMessage(JSON.stringify(msg), ampBody$);
    } else {
      let counter = 0;
      const waitForClass = setInterval(() => {
        ampBody$ = $(this.pwa.session.docObjActive.shadowBody);
        counter += 1;
        if (ampBody$.hasClass("pdp")) {
          clearInterval(waitForClass);
          this.openModal(skuId);
        } else if (counter > 5) {
          clearInterval(waitForClass);
        }
      }, 150);
    }
  }

  /**
   *
   * @param {CashJsCollection} form - jQuery-like form object
   * This function renders the personalization modal for pdp
   */
  async personalizeModalRender(prodId, skuId) {
    // get vendor details
    let pdpDet = await this.pwa.amp.ampGetState(`pdpDet${prodId}`);
    let vendorId = pdpDet.data.PRODUCT_DETAILS.VENDOR_ID
      ? pdpDet.data.PRODUCT_DETAILS.VENDOR_ID[0]
      : "";
    if (!vendorId) {
      console.warn(
        "Personalize: personalizeModalRender, Couldn't get vendorId"
      );
      return;
    }

    let url = await this.vendorUrlGet(prodId, skuId, vendorId);
    let modalTemp = this.vendorIframeTemplate(url);
    $(this.pwa.session.docObjActive.shadowBody).append(modalTemp);

    // only call this method once
    if (!this.messageListenerAdded) {
      this.addMessageListener();
    }
  }

  /**
   * called from interaction param router, calls open modal if there is a skuid, otherwise waits until we can get the skuId then opens the modal
   * @param {object} params - url search params
   */
  async personalizeParamRouter(params) {
    await this.pwa.util.waitForProp("docObjActive", this.pwa.session);
    if (params.skuId) {
      this.openModal(params.skuId);
    } else {
      //react doesnt send the skuId, can remove when we retire react
      let prodId = this.pwa.site.prodIdGet(new URL(location.href));
      let pdpDetails = await this.pwa.pdpDataAbstraction.getSkuDetails(prodId);
      let skuId = pdpDetails.SKU_ID;
      this.openModal(skuId);
    }
  }

  /**
   * removes the personalized items from pdpdetails state, and modifies the page
   * @param {string} skuId - sku id
   */
  async removeData(skuId) {
    let prodId = this.pwa.site.prodIdGet(new URL(location.href));
    let pdpDet = await this.pwa.amp.ampGetState(`pdpDet${prodId}`);
    if (pdpDet.data.PRODUCT_DETAILS.SKU_ID == skuId) {
      let prodDet = pdpDet.data.PRODUCT_DETAILS;
      prodDet.IS_PRICE = prodDet.notPersonalizePrice;
      delete prodDet.notPersonalizePrice;
      delete prodDet.personalized;
      prodDet.PRODUCT_IMG_ARRAY = this.imageArrayUpdate(
        prodDet.PRODUCT_IMG_ARRAY,
        -1,
        skuId
      );
    }
    pdpDet.data.SKU_DETAILS.forEach(function updateSku(skuItm) {
      if (skuItm.SKU_ID === skuId) {
        delete skuItm.personalized;
        skuItm.IS_PRICE = skuItm.notPersonalizePrice;
        delete skuItm.notPersonalizePrice;
        skuItm.PRODUCT_IMG_ARRAY = this.imageArrayUpdate(
          skuItm.PRODUCT_IMG_ARRAY,
          -1,
          skuId
        );
      }
    }, this);
    $(this.pwa.session.docObjActive.shadowBody)
      .find(".prodFulfillmentList2, #stickyCtaList")
      .removeClass("personalized");
    delete this.personalizedSku[skuId];
    sessionStorage.removeItem(`personalized-${skuId}`);
    let obj = {};
    obj[`pdpDet${prodId}`] = pdpDet;
    this.pwa.amp.ampsSetState(obj);
  }

  /**
   * creates and shows the error modal when there is an error loading the vendor modal
   */
  reportError() {
    $("body").addClass("modalOpen");
    let template = this.reportErrorModalTemplate();
    $(this.pwa.session.docObjActive.shadowBody).append(template);
  }

  /**
   * close report error modal, called from data-click-handler
   * @param {String} argstring
   * @param {CashJsCollection} target$ - Event target
   */
  reportErrorModalClose(argString, target$) {
    target$.closest(".modal").remove();
  }

  /**
   * creates the modal html for showing there was an error with the vendor modal
   */
  reportErrorModalTemplate() {
    return /*html*/ `
    <div id="vendorErrorModal" class="modal active">
      <style>
        .panelAlert {
          background: #fff1f2;
          border: 2px solid #f2c0c1;
          border-radius: 5px;
          line-height: 1.43;
        }
      </style>
      <div class="modalContent flexModal">
        <div class="flex midCtr modalContentInner parent">
          <button class="btn modalClose" data-modal-close aria-label="Close vendor error Modal" type="button" data-click-handler="personalize.reportErrorModalClose()">
            <svg class="wi wiClose noTap">
              <use xlink:href="#wiClose"></use>
            </svg>
          </button>
          <div class="vp05 gp1 panelAlert">
            We are sorry! A system error occurred. Personalization isn't available for this product right now. Please call 1-800-GO-BEYOND
            or email us at customer.service@bedbath.com for assistance.
          </div>
        </div>
      </div>
    </div>
    `;
  }

  /**
   * sends a post message to our vendor iframe
   * @param {any} msg - message that should be sent
   * @param {CashJsCollection} ampBody$ - current active amp body
   */
  sendMessage(msg, ampBody$) {
    let vendorFrame = ampBody$.find("#vendorIframeModal iframe");
    if (vendorFrame.length) vendorFrame[0].contentWindow.postMessage(msg);
  }

  /**
   * updates pdpdetails state to render the new personalized item, and modifies the page
   * @param {string} prodId - product id
   * @param {string} skuId - sku id
   */
  async updatePdp(prodId, skuId) {
    let pdpDet = await this.pwa.amp.ampGetState(`pdpDet${prodId}`);
    let vendorData = this.personalizedSku[skuId];
    if (pdpDet.data.PRODUCT_DETAILS.SKU_ID == skuId) {
      let prodDet = pdpDet.data.PRODUCT_DETAILS;
      prodDet.personalized = vendorData;
      prodDet.notPersonalizePrice = prodDet.IS_PRICE;
      prodDet.IS_PRICE = vendorData["final-price"];
      prodDet.PRODUCT_IMG_ARRAY = this.imageArrayUpdate(
        prodDet.PRODUCT_IMG_ARRAY,
        1,
        skuId
      );
    }
    pdpDet.data.SKU_DETAILS.forEach(function updateSku(skuItm) {
      if (skuItm.SKU_ID === skuId) {
        skuItm.personalized = vendorData;
        skuItm.notPersonalizePrice = skuItm.IS_PRICE;
        skuItm.IS_PRICE = vendorData["final-price"];
        skuItm.PRODUCT_IMG_ARRAY = this.imageArrayUpdate(
          skuItm.PRODUCT_IMG_ARRAY,
          1,
          skuId
        );
      }
    }, this);
    $(this.pwa.session.docObjActive.shadowBody)
      .find(".prodFulfillmentList2, #stickyCtaList")
      .addClass("personalized");

    let obj = {};
    obj[`pdpDet${prodId}`] = pdpDet;
    this.pwa.amp.ampsSetState(obj);
  }

  /**
   * gets the vendor files needed to be added to the iframe
   * @param {string} vendorId - vendor id from pdpdetails
   */
  async vendorDetailsGet(vendorId) {
    if (
      this.vendorDetails &&
      this.vendorDetails.data &&
      this.vendorDetails.vendorId == vendorId
    ) {
      return this.vendorDetails.data.data.keysConfig[
        `/configs/vendorConfig/vendorInfo/${vendorId}`
      ];
    }
    let vendorFetch = await fetch(
      `${location.origin}/apis/stateless/v1.0/config/v3/site-configs/vendorconfig/vendorinfo/${vendorId}?caller=xt`,
      {
        credentials: "include",
        method: "GET",
        headers: Object.assign({
          "Content-Type": "application/json, text/plain, */*",
          "x-bbb-site-id": this.pwa.session.siteId,
        }),
      }
    );
    this.vendorDetails = {
      data: await vendorFetch.json(),
      vendorId,
    };
    return this.vendorDetails.data.data.keysConfig[
      `/configs/vendorConfig/vendorInfo/${vendorId}`
    ];
  }

  /**
   * creates the modal html for rendering the our iframe
   * @param {string} url - our url for iframe to contain the vendor js files
   */
  vendorIframeTemplate(url) {
    return /*html*/ `
    <style>
      #vendorIframeModal {
        background: none;
        overflow-y: hidden;
      }
    </style>
    <div id="vendorIframeModal" class="modal">
      <iframe
        class="s12 h100"
        src=${url}
        title="Personalize Vendor Modal"
      >
      </iframe>
    </div>
    `;
  }

  /**
   * calls BBB api to get better data about the personalized item
   * @param {object} data - data from vendor iframe
   */
  async venderPersonalizeDataGet(data) {
    let skuId = data.sku;
    let vendorId = data.vendorId || this.vendorDetails.vendorId;
    let url = `${location.origin}/apis/services/catalog/v2.0/personalization/price?vendorId=${vendorId}&sku=${skuId}&refNum=${data.refnum}&siteId=${this.pwa.session.siteId}&channel=DesktopWeb`;
    let personalizeDetailsFetch = await fetch(url, {
      credentials: "include",
      method: "GET",
      headers: Object.assign({
        "Content-Type": "application/json",
        "x-bbb-site-id": this.pwa.session.siteId,
      }),
    });
    let personalizeDetails = await personalizeDetailsFetch.json();
    Object.assign(data, personalizeDetails.data.customizations[0]);
    // if this is the case the edit button has been clicked and the data needs to be refreshed
    if (this.personalizedSku[skuId]) {
      await this.removeData(skuId);
    }
    this.personalizedSku[skuId] = data;
    let prodId = this.pwa.site.prodIdGet(new URL(location.href));
    sessionStorage.setItem(`personalized-${skuId}`, data.refnum);
    this.updatePdp(prodId, skuId);
  }

  /**
   * creates url for our iframe that hosts the vendor javascript files
   * @param {string} prodId - product id
   * @param {string} skuId - sku id
   * @param {string} vendorId - vendor id from pdpdetails
   * @param {String} refnum (opt) - refnum is made after personalize call, was added here to create attribute on button in iframe, not needed to be passed
   */
  async vendorUrlGet(prodId, skuId, vendorId, refnum) {
    let vendorDetails = await this.vendorDetailsGet(vendorId);
    return `${
      location.origin
    }/amp/7865/vendorFrameV1.html?vendorId=${vendorId}&siteId=${
      this.pwa.session.siteId
    }&prodId=${prodId}&skuId=${skuId}${
      refnum ? `refnum=${refnum}` : ""
    }&vendorDetails=${encodeURIComponent(JSON.stringify(vendorDetails))}`;
  }
}
class Pdp {
  constructor(pwa) {
    this.pwa = pwa;
    this.baseImgUrlReg = /https[^?]+/gi;
  }

  /**
   * Before Render functions for PDP
   * @param {CashJsCollection} ampDoc$ - amp document
   * @param {URL} urlObj - url being loaded
   * @param {Object} changeStore changeStore data
   * @param {String} pdpSkuId (opt) - skuId if product is a skuId url
   */
  async ampBeforeRenderPdp(ampDoc$, urlObj, changeStore, pdpSkuId) {
    if (!this.pwa.session.docTests.isPDPReg.test(urlObj.pathname)) return;

    // prevent triggering amp-bind too early with ampsSetState calls.
    this.pwa.session.ampStateUnstable = true;

    /*
      Hotfix for PPS-6318
      Edge case where default sku has a "/"" in the size
      first color selection does not find a sku
    */
    const newExp = ` ( !colorAndSize ? ( color ? getObj(prodStateId).data.SKU_DETAILS.filter( skuObj => skuObj.COLOR == color ) : size ? getObj(prodStateId).data.SKU_DETAILS.filter( skuObj => skuObj.SKU_SIZE == size ) : [] ) : (getObj(prodStateId).data.SKU_DETAILS.filter( skuObj => skuObj.COLOR == color && skuObj.SKU_SIZE == size.replace('&#x2F;', '/') ) ) )[0].SKU_ID || '' `;
    ampDoc$.find("#skuIdByColorSize").attr("expression", newExp);

    // Collections transition from amp to PWA
    this.collectionBeforeRender(ampDoc$, urlObj);

    // TEMP: expand accessories and collections on desktop and mobile.
    // Consider removing after New collections UI been published?
    if (ampDoc$.find("#childView").length) {
      ampDoc$
        .find("#collections")
        .addClass("accExpanded")
        .find("#childProdsList")
        .removeAttr("hidden");
      // ampDoc$
      //   .find("#accessories")
      //   .addClass("accExpanded")
      //   .find("#childProdsList")
      //   .removeAttr("hidden");
      if (
        ampDoc$.find("#collections").length &&
        ampDoc$.find("body").hasClass("pdpV21")
      ) {
        this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "childView", {
          active: true,
          view: "list",
        });
      } else if (!ampDoc$.find("body").hasClass("pdpV21")) {
        // backwards compatibility
        this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "childView", {
          active: true,
          view: "list",
        });
      }
    }
    // replace slides with skuSlides if ?skuId parameter is present
    // Some products have over 100 skus, so we have to be efficient here:
    // ex: https://www.bedbathandbeyond.com/store/product/ugg-avery-3-piece-reversible-comforter-set/5321070?wmPwa&wmDebug&wmFast&skuId=69504154
    if (pdpSkuId) {
      let prodId = this.pwa.site.prodIdGet(urlObj);
      /* 1. Sku-Specific Product Images */
      let slidesState = ampDoc$.find("#skuSlides script")[0];
      let slides = {};
      if (slidesState) {
        slides = JSON.parse(slidesState.textContent);
      }
      let skuSlides = slides[pdpSkuId];
      if (pdpSkuId && skuSlides) {
        let slideIdx = 0;
        ampDoc$
          .find(
            ".placeholder .prodSlide amp-img, .placeholder .prodSlideThumb, .placeholder img[data-hero]"
          )
          .each((i, e) => {
            let slide$ = $(e);

            // Some PDPs have so many variants, we can't store all the slides in #skuSlides.
            // We will just replace Hero image (slide 1) for now.
            if (slide$.is(".prodSlideThumb")) return slide$.addClass("wHide");

            let src = slide$.attr("src");
            let imgId = skuSlides[slideIdx].imageId;
            let skuUrl = `${this.pwa.session.apiInfo.scene7RootUrl}/${imgId}`;
            if (!src || !imgId) return;
            src = src.replace(this.baseImgUrlReg, skuUrl);
            slide$.attr("src", src);

            let srcset = slide$.attr("srcset");
            if (!srcset) return;
            srcset = srcset.replace(this.baseImgUrlReg, skuUrl);
            slide$.attr("srcset", srcset);
          });
        ampDoc$
          .find(`#prodFulfillmentList${prodId}`)
          .attr("pdpSkuIdUpdatePending", pdpSkuId);
      } else {
        // handle legacy PDPs without image information
        ampDoc$
          .find(`#prodFulfillmentList${prodId}`)
          .attr("pdpSkuIdUpdatePending", "ampBindTrigger");
      }
    }

    /* Ghetto data-hero until /wm-optimized and maybe after */
    ["#prodSlideCarousel amp-img", "#prodSlideSelector amp-img"].forEach(
      function (selector) {
        let firstImg = ampDoc$.find(selector).eq(0);
        if (!firstImg.length) return;
        // TODO - move LCP preload to appshell on first load
        // $("head").append(
        //   `<link rel="preload" href="${firstImg.attr("src")}" as="image">`
        // );
        firstImg.html(`
          <img
            alt="${firstImg.attr("alt")}"
            src="${firstImg.attr("src")}"
            class="i-amphtml-fill-content i-amphtml-replaced-content"
          >
        `);
        firstImg[0].outerHTML = firstImg[0].outerHTML.replace(
          /amp-img/g,
          "amp-layout"
        );
      }
    );

    // PDP quickView Modal view (when opened from PLP pages)
    this.pwa.quickView.quickViewBeforeRender(ampDoc$.find("body"), urlObj);

    // PDP reviews
    if (/writeReview=/gi.test(urlObj.search)) {
      await this.pwa.site.scrapeProdData(ampDoc$, urlObj);
    }

    // TEMP 12.1.20 until pdp cache clears.
    ampDoc$.find("#prodDeliverZipList").attr("binding", "always");

    function filterFacets(filterType) {
      const sddElems = ampDoc$.find("[data-filters]");
      sddElems
        .filter(
          `
            [data-filters="filtersWrap"],
            [data-filters="${filterType}Active"]
            `
        )
        .removeAttr("hidden");
    }
    // TODO - handle if getDefaultStoreByLatLong has not downloaded and modified userSession.changeStore yet.
    // In appshell, this happens after getDefaultStoreByLatLng is downloaded:
    //    sessionStorage.setItem('amp_sessionStorage', JSON.stringify(userSession));

    // Update product list with storeId and sddZipCode
    let localProdSkuParams = "";
    if (changeStore && changeStore.storeId)
      localProdSkuParams += `&bopisStoreId=${changeStore.storeId}`;
    if (changeStore && changeStore.sddZipcode)
      localProdSkuParams += `&sddStoreId=${changeStore.sddStoreId || 1}`;
    if (localProdSkuParams)
      ampDoc$
        .find(
          `
                #prodSku,
                #pricesList,
                #freeShipAllList,
                #outOfStockBtnList,
                #otherCartsList,
                #prodSkusAll,
                #countdownTimer
              `
        )
        .each((i, e) => {
          e.setAttribute("src", e.getAttribute("src") + localProdSkuParams);
        });

    if (/sdd=true/i.test(urlObj.search)) {
      filterFacets("sdd");
      this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "skuFacets", {
        sddActive: true,
      });
      /* below is for PDP two col A/B test */
      this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "pdpCtaType", "deliverIt");
    }

    if (/pickup=true/i.test(urlObj.search)) {
      filterFacets("bopis");
      this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "skuFacets", {
        bopisActive: true,
      });
      /* below is for PDP two col A/B test */
      // https://www.buybuybaby.com/store/product/johnson-39-s-head-to-toe-27-1-oz-wash-shampoo/5215591?categoryId=32555&pickup=true
      this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "pdpCtaType", "pickItUp");
    }

    // hide all payment options if this is a gift card page. PP-579
    // Can probably remove this if/when prod.data.SKU_DETAILS[0].GIFT_CERT_FLAG is accurate
    if (/gift-card\//i.test(urlObj.pathname)) {
      ampDoc$.find("div#payOption").remove();
    }

    // PDPv2 - Set amp-list initial height based on CSS breakpoint
    ampDoc$.find("[data-init-height]").each((i, e) => {
      try {
        const ampList = $(e);
        const heights = JSON.parse(ampList.attr("data-init-height"));
        const currHeight = Object.entries(heights)
          .filter(([mediaWidth]) => parseInt(mediaWidth) <= window.innerWidth)
          .pop();
        if (currHeight) ampList.attr("height", currHeight[1]);
        /*
          Because we could not get an accurate height for collections
          and because having a show more button on pure amp would not allow the user to see the atc
          without clicking the show more button,
          I left the collections as a variable amp list, which means even the heights on it do not affect it from collapsing
          So this sets the min-height on the parent element
        */
        if (ampList.is("[data-setParentMinHeight]"))
          ampList.parent().css("min-height", currHeight[1]);
      } catch (e) {
        console.log(
          "unable to set amp-list initial height based on document width"
        );
      }
    });

    // Disable Klarna until Sunday, 5.17.21
    if (!this.pwa.session.features.pdpKlarna) {
      ampDoc$.find(".paymentOption.klarna").remove();
    } else {
      ampDoc$.find("div#payOption div.klarna").css({ display: "block" });
    }

    // TEMP for phase #1 of Klarna, hide the "Show More" button in the payment options
    if (!this.pwa.session.features.pdpShowShowMorePaymentsLink) {
      ampDoc$.find("div#payOption div.moreOptions").hide();
      if (this.pwa.session.features.pdpKlarna) {
        ampDoc$
          .find("div#payOption")
          .css({ height: "auto", "min-height": "72px" });
      } else {
        ampDoc$
          .find("div#payOption")
          .css({ height: "auto", "min-height": "46px" });
      }
    }

    // Update Criteo IDs - 6.14.21
    // If we still have desktop IDs, switch to mobile
    // XXX - MCM - This is temp - Once rebuilt, the new AMPs should now have the mobile container IDs by default.
    // This can be deleted once the PDPs have all been rebuild, maybe in about a month? 7/14/21
    // if (window.innerWidth < 768) {
    //   ampDoc$.find("#viewItem-PDP").attr("id", "viewItem_mobile-PDP");
    // }

    // remove PLA carousel if mcid not present
    let plaFeature = ampDoc$.find("#PLA-ads-container");
    if (this.pwa.session.features.pdpPla && urlObj.searchParams.has("mcid")) {
      const styles = ampDoc$.find("style[amp-custom]");
      const plaCss = `
        #PLA-ads {
          min-height: 640px;
        }
        .amp-sacrifice.plaItem {
          height: auto;
          line-height: 1.2;
        }
        div.plaItem:nth-of-type(n + 5) {
          display: none;
        }
        .showMore div.plaItem:nth-of-type(n + 5) {
          display: block;
        }
        .bRad05 {
          border-radius: 0.5rem;
          overflow: hidden;
        }
        @media (min-width: 31rem) {
          .ph6 {
            width: 50%;
          }
        }
        @media (min-width: 48rem) {
          .plaContainer {
            margin-top: 3rem;
          }
          div.plaItem:nth-of-type(n + 4) {
            display: none;
          }
          .showMore div.plaItem:nth-of-type(n + 4) {
            display: block;
          }
        }
        @media (min-width: 64rem) {
          #PLA-ads {
            min-height: 664px;
          }
          div.plaItem:nth-of-type(n + 4) {
            display: block;
          }
          div.plaItem:nth-of-type(n + 5) {
            display: none;
          }
          .showMore div.plaItem:nth-of-type(n + 5) {
            display: block;
          }
        }
        @media (min-width: 80rem) {
          #PLA-ads {
            min-height: 691px;
          }
        }
      `;
      styles.text(styles.text() + plaCss);
      plaFeature.removeClass("wHide");
    } else {
      plaFeature.remove();
    }

    //replace PDP breadcrumbs with the breadcrumbs scrapped from the PLP.
    if (
      this.pwa.session.pdpBreadcrumb &&
      this.pwa.session.pdpBreadcrumb.length > 0
    )
      this.setPdpBreadcrumb(ampDoc$);

    this.pwa.desktop.ampBeforeRenderPdp(ampDoc$);
  }

  async ampListPostRenderPdp(ampList) {
    this.scrollAfterListLoad(ampList);
    if (ampList.is(".pricesList")) {
      // PDP and PLP amp pages assume that state is not set until the user interacts with the page.
      // If third party scripts or pwamp prematurely evaluates all the amp expressions
      // via setState or triggering click events, we need to then
      // keep evaluating amp-state until pdp-details downloads and all data is present.
      // if (
      //   (ampList.children().not("[placeholder]").text() || "").trim() == "" &&
      //   !this.pwa.pdp.renderTriggerInterval
      // ) {
      //   this.pwa.pdp.renderTriggerInterval = setInterval(
      //     function () {
      //       this.pwa.amp.ampsSetState({
      //         random: Math.random(),
      //       });
      //     }.bind(this),
      //     200
      //   );
      // } else {
      //   clearInterval(this.pwa.pdp.renderTriggerInterval);
      // }
      // setTimeout(this.pwa.amp.ampsAmpStateIsStableEvt.bind(this), 500);
      // // TODO - refactor this and .prodFulfillmentList resize check
      // // expand if prodList is larger than container
      // const replacedContent = ampList
      //   .find("div[placeholder] ~ div:not([overflow]) > div:first-child")
      //   .eq(0);
      // const replacedContentHeight = replacedContent.height();
      // if (replacedContentHeight !== ampList.height()) {
      //   ampList.css("height", replacedContentHeight);
      // }
      this.pwa.util.resetListHeight(ampList);
      return this.pwa.site.updatePaymentOptionPriceLabels();
    }
    if (ampList.is("#accList")) {
      this.pwa.site.socialAnnexPosition();
      if (window.pdpLoadChildProdData) {
        window.pdpLoadChildProdData();
      }
      return;
    }
    if (ampList.is(".prodAttr2List")) {
      this.pwa.util.resetListHeight(ampList);
      /*
        Special use case due to store not being set when we build the pages and free shipping attribute
        tending to be store specific. So placehoder would be empty, so the ampList would be too short
      */
      if (ampList.find(".attrWrapper").eq(1).outerHeight() > ampList.height())
        ampList.height(ampList.find(".attrWrapper").eq(1).outerHeight());
    }
    // check to see if a SKU is selected
    // #prodTitleList is only visible once a size or color is selected
    if (ampList.is("#prodTitleList,.prodTitleList2")) {
      // 3.1.22 JP - Moved tealium event emitter to pdpAmpPostRender so it fires on pageload instead of on every amp-list refresh. Added data-cta attr to facet btns to handle facet clicks instead of firing on the list refreshes.
      // try {
      //   let skuId = await this.pwa.pdpDataAbstraction.getSelectedSkuId();
      //   // cart.sku is only set once all product attributes have been selected
      //   if (skuId !== "" && typeof pdpClickOnSku !== "undefined") {
      //     // call Telium, let them know a SKU has been selected
      //     pdpClickOnSku();
      //   }
      // } catch (ex) {
      //   console.error("Could not call pdpClickOnSku", ex);
      // }
      this.pwa.util.resetListHeight(ampList);
      return;
    }

    if (ampList.is(".prodFulfillmentList,.prodFulfillmentList2")) {
      // expand if prodList is larger than container
      this.pwa.util.resetListHeight(ampList);

      if (/type=oosForm/gi.test(location.search))
        this.pwa.site.pdpOosAmpHandler(ampList);

      // TODO JW - Is this still necessary?
      const pendingStatus = ampList.attr("pdpSkuIdUpdatePending");
      console.log("pendingStatus", pendingStatus);
      if (pendingStatus) {
        if (pendingStatus == "ampBindTrigger") {
          // trigger amp-bind cycle if we need to update the images and title for a specific sku
          // 6.11.21 TODO - remove after all PDP pages rebuilt
          // this.pwa.amp.ampsSetState({
          //   random: Math.random(),
          // });
        } else {
          // images were updated in ampBeforeRenderPdp
          let doc$ = ampList.closest("body");
          let prodId = this.pwa.site.prodIdGet(new URL(location.href));
          let pdpDetails = await this.pwa.amp.ampGetState(`pdpDet${prodId}`);
          doc$
            .find(".prodTitle")
            .html(pdpDetails.data.PRODUCT_DETAILS.DISPLAY_NAME);
        }
        ampList.removeAttr("pdpSkuIdUpdatePending");
      }

      if (
        this.pwa.session.features.registryEnable &&
        this.pwa.user.hasRegistry &&
        this.pwa.registry.renderCtaMenuFlag
      ) {
        let btn$ = ampList.find(".registryCta");
        if (btn$.length) {
          this.pwa.registry.registryCtaMenuRender(btn$, true);
        }
      }

      await this.pwa.personalize.addVendorModal(ampList);
    }
    if (ampList.is(".collegeFulfillList1") && this.pwa.college.isCollege) {
      this.pwa.college.modifyBopisMsg(ampList);
    }

    if (ampList.is(".prodRatings2, .prodRatings")) {
      this.pwa.pdp.stickyReviewsWidth(ampList);
    }

    if (ampList.is(".colors2List")) this.pwa.util.resetListHeight(ampList);

    if (ampList.is(".cProdCardList")) {
      this.pwa.pdp.tealiumPdpCollectionItemsEvents(ampList);
    }

    if (ampList.is("#reviews,#qnaPreviewList"))
      this.pwa.site.socialAnnexPosition();
  }

  /**
   * Register/Fire tealium events for PDP collection items on Scroll.
   * @param {CashJsCollection} ampList - PDP amp-list
   */
  async tealiumPdpCollectionItemsEvents(ampList) {
    if (this.pwa.session.isFast) return;

    // wait for tealium javascript to load
    await this.pwa.util
      .waitForProp("pdpIOCallback")
      .catch((e) => console.log(e));

    if (!window.pdpIOCallback) return;
    // Trigger Tealium intersection observer for pdp collection items.
    const io = new IntersectionObserver(window.pdpIOCallback, {
      root: null,
      rootMargin: "0px",
      threshold: 1,
    });
    ampList.find(".cProdCard").each((i, prodName) => io.observe(prodName));
  }

  async ampPostRenderPdp(ampBody$, urlObj, pathAndSearch) {
    if (!this.pwa.session.docTests.isPDPReg.test(pathAndSearch)) return;

    this.pwa.quickView.quickViewPostRender(ampBody$);

    // ampBody$.find("div[\\[hidden\\]]").each((i, elem) => {
    //   // debugger;
    //   console.log('hiddenBind', elem.outerHTML);
    //   this.pwa.util.elemAttrEvent(
    //     elem,
    //     "hidden",
    //     this.pwa.site.socialAnnexPosition.bind(this)
    //   );
    // });
    // // fluid-height ad resizing requires Social Annex repositioning.
    // ampBody$.find("amp-ad").each((i, elem) => {
    //   this.pwa.util.elemAttrEvent(
    //     elem,
    //     "style",
    //     this.pwa.site.socialAnnexPosition.bind(this)
    //   );
    // });

    this.pwa.desktop.ampPostRenderPdp(ampBody$);

    this.pwa.site.recentlyViewedDataUpdate(urlObj);

    if (!this.pwa.session.isPdpV21)
      this.pwa.site.activatePaymentOptions(ampBody$);

    // https://em02-www.bbbyapp.com/store/product/gourmet-settings-promise-flatware-collection/211901?wmPwa&categoryId=10534#collections
    // JW 7.5.21 - These were evaluating amp-bind expressions before data was present.
    if (/collections/i.test(urlObj.hash)) {
      document.addEventListener(
        "ampStateIsStable",
        function (ampBody$) {
          ampBody$
            .find('[data-interact="expandCollections"]')
            .each((i, elem) => elem.click());
        }.bind(null, ampBody$)
      );
    }

    if (/reviews/i.test(urlObj.hash)) {
      document.addEventListener(
        "ampStateIsStable",
        function (ampBody$) {
          ampBody$
            .find('[data-cta="pdpProductReviewsClick"]')
            .each((i, elem) => elem.click());
        }.bind(null, ampBody$)
      );
    }

    // Fire tealium pdpClickOnSku on pdp pageload
    // It's also fired via data-cta attr on facets button clicks
    // UPDATE: comented out at request of Radhesh and Peter He as they determined it was actually unecessary
    // https://bedbathandbeyond.atlassian.net/browse/PPS-5000
    // try {
    //   let skuId = await this.pwa.pdpDataAbstraction.getSelectedSkuId();
    //   // cart.sku is only set once all product attributes have been selected
    //   await this.pwa.util.waitForProp("pdpClickOnSku");
    //   if (skuId !== "" && typeof pdpClickOnSku !== "undefined") {
    //     // call Telium, let them know a SKU has been selected
    //     const [prodId] = location.pathname.match(/\d+$/) || [""];
    //     pdpClickOnSku(prodId);
    //   }
    // } catch (ex) {
    //   console.error("Could not call pdpClickOnSku", ex);
    // }

    /*
         I had to do this in an intersection observer because in post render
         I wasn't able to get accurate heights on the elements
       */
    this.pwa.intersectHandlersRegister(
      "prodDetailsIntersection",
      ampBody$[0],
      `.prodDescCont`,
      async (pwa, intersectionEntry) => {
        // Check if we need to hide the show more button on seo content
        this.pwa.site.checkSeoHeight(ampBody$, {
          limitContClass: "prodDescCont",
          btnClass: "descBtn",
          contClass: "descTxt",
          overlay: "showMoreCover",
        });
        return pwa.intersectHandlerUnregister(
          "prodDetailsIntersection",
          intersectionEntry.target
        );
      }
    );

    this.pwa.intersectHandlersRegister(
      "spectListRender",
      ampBody$[0],
      `.specificationList`,
      async (pwa, intersectionEntry) => {
        // Check if we need to hide the show more button on seo content
        if (intersectionEntry.intersectionRatio > 0) {
          this.updateSpecs(ampBody$);
          return pwa.intersectHandlerUnregister(
            "spectListRender",
            intersectionEntry.target
          );
        }
      }
    );

    // remove when marketplace flag is removed
    // remove showmorecover and button from marketplace shipping policy since it is so short. Can be handled by pdpv21_policies after render when
    // flag is removed and wData.shippingContent is overwritten by wData.vendorShippingContent
    let marketplaceCont = ampBody$.find("#marketplaceShippingCont");
    if (
      marketplaceCont.length &&
      marketplaceCont.text().trim() &&
      !marketplaceCont.hasClass("wHide")
    ) {
      marketplaceCont
        .closest(".parent")
        .addClass("vb25")
        .find(".showMoreCover")
        .remove();
      ampBody$.find(".shippingPolicyBtn").remove();
      marketplaceCont.children().removeAttr("[class]");
      marketplaceCont.prev().remove();
    }
  }

  /**
   * Get the width of the above the fold reviews count and replace the sticky reviews if the width is smaller than the correct width
   * the current width of the sticky reviews is calculated in the pdp before render
   * @param {CashJs Node} ampList - amp list that is being rendered and you want to compare width
   */
  stickyReviewsWidth(ampList) {
    let reviewsDiv = ampList.find('div[data-cta="pdpProductReviewsClick"]');
    let length = 0;
    if (reviewsDiv.length) {
      length = reviewsDiv.text().replace("Reviews", "").trim().length;
    }

    let replacementWidth = 12 + 8 * length;
    let stickyReviewsList = ampList.closest("body").find("#stickyReviewsList");
    let oldWidth = 0;

    if (stickyReviewsList.length) {
      oldWidth = stickyReviewsList.width();
    }

    if (replacementWidth > oldWidth) {
      stickyReviewsList.each((i, el) => {
        $(el).width(`${replacementWidth}px`);
      });
    }
  }

  async updateStructuredData() {
    // When pdp structured data is implemented with pdp_structuredData snippet (flagged behind features.pdpStructuredData) we don't need this function anymore, as it will auto-update with data from pdp-details.
    if (this.pwa.session.features.pdpStructuredData) return;

    try {
      // 11.1.21 - Updated to account for migrating prod schema from pdp_schemaSsr to wompLib.createStructuredData (#schemaGraph)

      // MetaLdJSON for preorder items
      let ldData = this.pwa.appshell.elems.head.find("#ldData");
      let schemaGraph =
        this.pwa.appshell.elems.head.find("#schemaGraph") ||
        this.pwa.appshell.elems.body.find("#schemaGraph");
      //let sku = urlObj.searchParams.get("skuId");
      // jk 6.14.21 We do not have pdpDetails yet. Where am I supposed to get preorder data from in ampBeforeRender?
      //let pdpDet = await this.pwa.pdpDataAbstraction.getPDPState("pdpDet");
      let pdpDet = await this.pwa.pdpDataAbstraction.getSkuDetails();
      if ((schemaGraph || ldData) && pdpDet) {
        let ldJson = {};
        try {
          if (schemaGraph.length && !ldData.length) {
            ldJson = JSON.parse(schemaGraph.html())["@graph"].find(
              (x) => x["@type"] == "Product"
            );
          } else if (ldData.length) {
            ldJson = ldJson = JSON.parse(ldData.html());
          }
        } catch (e) {
          console.warn(`Unable to parse structured data. Error: ${e}`);
          return;
        }
        if (pdpDet.SKU_ID) {
          // 11.1.21 - SKU_ID exists by default now
          // sku selected or single sku
          ldJson.offers.availability = pdpDet.IS_EVERLIVING
            ? "https://schema.org/Discontinued"
            : !pdpDet.ONLINE_INVENTORY &&
              !pdpDet.bopisAvailable &&
              !pdpDet.sddAvailable
            ? "https://schema.org/OutOfStock"
            : pdpDet.data &&
              pdpDet.data.PRODUCT_DETAILS &&
              pdpDet.data.PRODUCT_DETAILS.storeOnly
            ? "https://schema.org/InStoreOnly"
            : pdpDet.BOPUS_EXCLUSION_FLAG > 0
            ? "https://schema.org/OnlineOnly"
            : pdpDet.isBackorder
            ? "https://schema.org/BackOrder"
            : pdpDet.isPreorder
            ? "https://schema.org/PreOrder"
            : "https://schema.org/InStock";

          // ldJson.offers.availability = pdpDet.isPreorder
          //   ? "https://schema.org/PreOrder"
          //   : pdpDet.isBackorder
          //   ? "https://schema.org/BackOrder"
          //   : pdpDet.IS_EVERLIVING
          //   ? "https://schema.org/Discontinued"
          //   : pdpDet.data &&
          //     pdpDet.data.PRODUCT_DETAILS &&
          //     pdpDet.data.PRODUCT_DETAILS.storeOnly
          //   ? "https://schema.org/InStoreOnly"
          //   : pdpDet.ONLINE_INVENTORY
          //   ? "https://schema.org/InStock"
          //   : "https://schema.org/OutOfStock";
          // ldJson.offers["@type"] = "Offer";

          ldJson.sku = pdpDet.SKU_ID;

          // Single sku selected or passed in url as ?skuId= query param
          if (
            (/skuId=[0-9]+/.test(location.search) ||
              pdpDet.data.params.skuId != pdpDet.SKU_ID) &&
            ldJson.offers
          ) {
            ldJson.offers["@type"] = "Offer";
            ldJson.offers.price = pdpDet.IS_PRICE.replace("$", "");
            delete ldJson.offers.lowPrice;
            delete ldJson.offers.highPrice;
          }
          // There is a SKU_ID by default but in case there isn't...
        } else if (
          pdpDet.ONLINE_INVENTORY == "Positive" ||
          pdpDet.ONLINE_INVENTORY == true
        ) {
          // Initial load, no sku selected yet on MSWP
          ldJson.offers.availability = "https://schema.org/InStock";
        } else if (
          pdpDet.storeOnly ||
          (pdpDet.data &&
            pdpDet.data.PRODUCT_DETAILS &&
            pdpDet.data.PRODUCT_DETAILS.storeOnly)
        ) {
          ldJson.offers.availability = "https://schema.org/InStoreOnly";
        } else {
          ldJson.offers.availability = "https://schema.org/OutOfStock";
        }

        ldJson.name = pdpDet.DISPLAY_NAME;
        if (schemaGraph.length && !ldData.length) {
          ldJson.aggregateRating.itemReviewed.name = pdpDet.DISPLAY_NAME;
        } else if (ldData.length) {
          ldJson.aggregateRating.name = pdpDet.DISPLAY_NAME;
        }
        ldJson.image =
          this.pwa.session.apiInfo.scene7RootUrl +
          "/" +
          pdpDet.PRODUCT_IMG_ARRAY[0].imageId;
        // ldData.html(JSON.stringify(ldJson));
        if (schemaGraph.length && !ldData.length) {
          const graphJson = JSON.parse(schemaGraph.html());
          graphJson["@graph"].splice(2, 1, ldJson);
          schemaGraph.html(JSON.stringify(graphJson));
        } else if (ldData.length) {
          ldData.html(JSON.stringify(ldJson));
        }
      }
    } catch (err) {}
  }

  setPdpBreadcrumb(ampDoc$) {
    try {
      ampDoc$.find("#productScript .breadcrumbs2 a").remove();
      let breadcrumb$ = ampDoc$.find("[data-dynamic-breadcumb]");
      this.pwa.session.pdpBreadcrumb.map((val) => {
        breadcrumb$.append(
          `<a class="black capitalize breadcrumb2" href='${val.url}'>${val.value}</a>`
        );
      });
      return true;
    } catch {
      console.warn(
        `pdp.setPdpBreadcrumb Unable to add pdp breadcrumb, Error: ${e}`
      );
      return false;
    }
  }

  /**
   *
   * @param {CashJsDoc} ampDoc$
   * @returns {Boolean}
   * https://bedbathandbeyond.atlassian.net/browse/PP-3298
   * It appears that the specs table on product details is specs for all the products on MSWP
   * This info will be displayed on pure amp
   * On pwa, this function is called from an intersection observer, to update the specs
   * for initial page load. After a user selects a facet, an amp-list is displayed
   * If SSWP, this function should return
   */
  async updateSpecs(ampDoc$) {
    try {
      let specTable = ampDoc$.find(`[data-specs-sku]`);
      if (specTable.length == 0) return false;
      let prodId = await this.pwa.site.prodIdGet(new URL(location.href));
      if (!prodId) return;
      let skuDet = await this.pwa.pdpDataAbstraction.getSkuDetails(prodId);
      let sku = skuDet.SKU_ID;
      let temp = ampDoc$.find("#specificationTemplate");
      if (!sku || !temp || !skuDet.SPECS) return false;
      let specObj = {};
      specObj.items = skuDet.SPECS.map((item) => {
        let [key, val] = Object.entries(item)[0];
        return { key: key, value: val };
      });
      await Promise.all([
        this.pwa.util.scriptAddMustache(),
        this.pwa.util.waitForProp("Mustache"),
      ]);
      let specHtml = Mustache.render(temp.html(), specObj);
      specTable.html(specHtml);
      return true;
    } catch (e) {
      console.warn(`pdp.updateSpecs Unable to update, Error: ${e}`);
      return false;
    }
  }

  async paymentToggle(str, target$, e) {
    let ampBody$ = target$.closest("body");
    await this.pwa.site.activatePaymentOptions(ampBody$);
    let toggleCont$ = target$.next();
    if (toggleCont$.attr("hidden") == "" || toggleCont$.attr("hidden")) {
      toggleCont$.removeAttr("hidden");
    } else {
      toggleCont$.attr("hidden", "true");
    }
  }

  /**
   *
   * @param {String} itemsJson  - json string representing skuId and productIds for adding to shopping list
   */
  async collectAddToShopList(str, targ$, e) {
    try {
      let itemsJson = targ$.closest("form").find(`[name="products"]`).val();
      itemsJson = itemsJson.replace(/,]/gi, "]");
      let atcObj = JSON.parse(decodeURIComponent(itemsJson));
      let bundleSkus = atcObj.reduce((acc, item, ind) => {
        if (item.qty !== "0") acc.push([item.prodId, item.skuId]);
        return acc;
      }, []);
      let added = this.pwa.user.bulkShoppingListAdd(bundleSkus);
    } catch (e) {
      console.log(`pdp.collectAddToShopList error. Error: ${e}`);
      return false;
    }
    return true;
  }

  /* Collection Item url share social platform */
  async copySocialUrl(str, target$, e) {
    try {
      const copyText = target$
        .closest(".modalContentInner")
        .find(".shareTxt")
        .val();
      await navigator.clipboard.writeText(copyText);
    } catch (e) {
      console.warn(`Error trying to copy to clipboard. Error: ${e}`);
    }
  }

  async collectionParamRouter(params, type) {
    this.pwa.site.cartAdd(params, type);
    // modify collection to keep state from amp
  }

  /**
   * This method initializes the skus that were selected on the native AMP document in PWA when a user adds
   * to cart from native amp (google cdn)
   * @param {CashJs Node} ampBody$  - reference to the cashJs Node that is a reference to the body of the amp document
   * @param {URL} url - Url object
   * @returns {Boolean} - success
   */
  collectionBeforeRender(ampBody$, url) {
    if (url.searchParams.get("type") !== "collectionAtc") return;
    try {
      let products = JSON.parse(
        decodeURIComponent(url.searchParams.get("products")).replace(
          /},]/i,
          "}]"
        )
      );

      /*
        Could have used amp-list for this, but decided no need for the overhead.
        Was going to use Mustache but then decided we didn't want to wait for it to load
        This creates states for each product in the collection
      */
      let childData = products.reduce((acc, item) => {
        let fulfillment = item.fulfillment
          ? `&fulfillment=${item.fulfillment}`
          : "";
        let qty = item.qty ? `&qty=${item.qty}` : "";
        acc += `<div class="static pixel">
        <amp-state id="pdpDet${item.prodId}"
            data-amp-replace="TIMEZONE"
            src="${this.pwa.session.apiInfo.apiPdpDetails}${item.prodId}${this.pwa.session.apiInfo.apiPdpParams}&isChild=true&tz=TIMEZONE&skuId=${item.skuId}${fulfillment}${qty}&allSkus=true&ssr=true"
        ></amp-state>
        </div>`;
        return acc;
      }, "");
      this.pwa.amp.ampSetStateBeforeRender(ampBody$, "collectionObj", products);
      ampBody$.find("#childProdsDataList").remove();
      ampBody$.find("#second").prepend(childData);
      return true;
    } catch (e) {
      console.warn(`pdp.collectionParamRouter Error: ${e}`);
      // clear params and show error
    }
    return false;
  }

  /**
   * This function gets the collectionObj that was created in the before render
   * It is used to initialize the collection products so the same quantity, fulfillment and facets are selected
   * as what was selected on the native amp page
   */
  async collectionHydrate() {
    // Unforunately since size and color have special characters in them I can not include in the atcObj
    // So we have to set state after skuFacets have been initialized
    try {
      setTimeout(this.pwa.amp.ampsAmpStateIsStableEvt.bind(this), 500);
      let prods = await this.pwa.amp.ampGetState("collectionObj");
      let obj = {};
      for (const prod in prods) {
        try {
          let qty = parseInt(prods[prod].qty);
          obj[`skuFacets${prods[prod].prodId}`] = {
            qty: qty,
            fulfillment: prods[prod].fulfillment,
          };
        } catch (e) {}
      }
      await this.pwa.amp.ampsSetState(JSON.stringify(obj));
    } catch (e) {
      console.warn(
        `pdp.collectionHydrate: Error hydrating the collection data. Error: ${e}`
      );
    }
  }

  /**
   * This is called when the last amp-list has rendered in the child products list
   * @param {CashJs Node} ampList - cashJs reference to child products list amp-list
   * @returns {undefined}
   */
  async collectionAmpToPwa(ampList) {
    if (!/type=collectionAtc/.test(location.search)) return;
    // amp to pwa atc transition

    // Scroll collections into view behind the modal
    ampList.closest("amp-list")[0].scrollIntoView({
      block: "end",
      behavior: "auto",
      inline: "center",
    });

    // Set fulfillment and quantities on the collection products
    this.pwa.pdp.collectionHydrate();

    // Clear the collections params
    this.pwa.util.clearParams(
      ["type", "products", "sddZip", "storeId"],
      location.href
    );
    return;
  }

  /**
   *
   * @param {Object} cartResp - This will be the response from /item
   * This needs to close the modal if it is open
   * And add errors to the appropriate collection objects
   * And scroll to the first error in the collection
   */
  async collectionAtcError(cartResp) {}

  /**
   * Since the reviews and Q&A are not loaded until they are close to the viewport (scroll)
   * When the user clicks a scroll link, the height of the page changes while scrolling and
   * the user is not scrolled to the correct location
   * @param {CashJsCollection} ampList - amp list that is being rendered from ampListPostRender
   */
  scrollAfterListLoad(ampList) {
    if (
      !this.pwa.session.scrollToNode ||
      !this.pwa.session.scrollList ||
      !ampList.is(this.pwa.session.scrollList)
    )
      return;
    let scrollNode = ampList
      .closest("body")
      .find(this.pwa.session.scrollToNode);
    delete this.pwa.session.scrollToNode;
    delete this.pwa.session.scrollList;
    if (scrollNode.length > 0)
      setTimeout(() => {
        scrollNode[0].scrollIntoView({
          behavior: "smooth",
        });
      }, 20);
  }

  /**
   * This sets up the callback for the amp-list by setting the flags for scrollAnchor
   * and listId
   * This is setup to only run the first time an amp-list has been loaded
   * @param {String} str - string containing the list id (id of amp-list that may affect the scroll) and scroll anchor (id of anchor we want to scroll to)
   */
  initScrollAfterListLoad(str) {
    let [listId, scrollAnchor] = str.split(",");
    if (
      $(this.pwa.session.docObjActive.shadowBody)
        .find(listId)
        .hasClass("i-amphtml-layout")
    )
      return;
    this.pwa.session.scrollToNode = scrollAnchor;
    this.pwa.session.scrollList = listId;
  }
}

class Plp {
  constructor(pwa) {
    this.pwa = pwa;
    this.getFeedbackUrl = this.getFeedbackUrl.bind(this);
  }

  /**
   * @param {CashJsCollection} ampBody$ - AMP document body before it is attached to Host
   */
  async ampPostRender(ampBody$) {
    // Only run plp.ampPostRender on PLP pages
    const docTests = this.pwa.session.docTests,
      pathname = location.pathname;
    if (
      !(docTests.isPLPReg.test(pathname) && !docTests.isCLPReg.test(pathname))
    )
      return;

    this.yesNoFeedback(ampBody$);

    // all changes to the zip modal on plp pages are done here
    this.plpSddZipModalRender(ampBody$);

    // 10.11.21 - Set search PLP robots tag with metaSeoFacetValue value in composit api response instead of based on result count
    // https://bedbathandbeyond.atlassian.net/browse/OR-1056
    let prodList = await this.pwa.amp.ampGetState("prodList");
    // Make sure there's a robots tag
    this.pwa.appshell.elems.head.find('meta[name="robots"]').remove();
    this.pwa.appshell.elems.head.append(
      `<meta name="robots" content="${prodList.metaSeoFacetValue}">`
    );
  }

  // construct the feedback url based on user input
  getFeedbackUrl(yesNoParam, feedbackItm) {
    // function to grap cookie value
    function getCookie(cname) {
      let name = cname + "=";
      let ca = document.cookie.split(";");
      for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == " ") {
          c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
          return c.substring(name.length, c.length);
        }
      }
      return "";
    }

    // construct url
    var url = "https://secure.opinionlab.com/ccc01/comment_card_d.asp?referer=";
    var encodedPortion = `https://search.${location.origin.replace(
      "https://",
      ""
    )}&customVars=`;
    var feedBackObj = {
      QM: getCookie("QuantumMetricSessionID"),
      FULL_URL: location.href,
      Yes_No_Response: yesNoParam,
    };
    if (feedbackItm) {
      feedBackObj.No_Response = feedbackItm;
    }
    url += encodeURIComponent(
      `${encodedPortion}${JSON.stringify(feedBackObj)}`
    );

    return url;
  }

  /**
   * updates faceted plp Seo elements
   *
   * @param {Object} session - object created from this.pwa.session
   */

  async facetedPlpSeo() {
    const prodList = await this.pwa.amp.ampGetState("prodList");
    if (
      prodList.appliedFacets.length > 2 ||
      prodList.appliedFacets.length === 0
    ) {
      return;
    }

    const excludedFacets = [
      "RATINGS",
      "ATTRIBUTES_FACET",
      "s_f_binProduct_Type",
    ];
    const appliedFacets = prodList.appliedFacets.filter(
      (appliedFacet) => !excludedFacets.includes(appliedFacet.id)
    );
    const filteredFacets = new Map();

    appliedFacets.forEach((appliedFacet) => {
      prodList.facets.forEach((facet) => {
        if (appliedFacet.id === facet.id) {
          const facetID = appliedFacet.id;
          if (filteredFacets[facetID]) {
            filteredFacets[facetID].value.push(appliedFacet.value);
          } else {
            filteredFacets[facetID] = {
              value: [appliedFacet.value],
            };
          }
        }
      });
    });

    const beforeFacetList = [
      "visualVariant.nonvisualVariant.SKU_FOR_SWATCH.COLOR_GROUP",
      "BRAND",
      "visualVariant.nonvisualVariant.SKU_FOR_SWATCH.SKU_SIZE",
      " s_f_binInterior_Construction_Material",
    ];
    const beforeFacets = new Map();
    const afterFacets = [];

    Object.keys(filteredFacets).forEach((key) => {
      if (beforeFacetList.includes(key)) {
        beforeFacets[key] = {
          value: `${filteredFacets[key].value.join(" ")}`,
        };
      } else {
        afterFacets.push(`${filteredFacets[key].value.join(" ")}`);
      }
    });

    let curTitle = $("title").text().split(" | ") || [];

    // caching title under data attribute to avoid duplicate facets
    if ($("title").attr("data-title")) {
      curTitle[0] = $("title").attr("data-title");
    } else {
      $("title").attr("data-title", curTitle[0]);
    }

    // create title and desc they are only slightly different
    let title = `${
      beforeFacets["visualVariant.nonvisualVariant.SKU_FOR_SWATCH.COLOR_GROUP"]
        ? `${beforeFacets["visualVariant.nonvisualVariant.SKU_FOR_SWATCH.COLOR_GROUP"].value} `
        : ""
    }${beforeFacets.BRAND ? `${beforeFacets.BRAND.value} ` : ""}${
      beforeFacets["visualVariant.nonvisualVariant.SKU_FOR_SWATCH.SKU_SIZE"]
        ? `${beforeFacets["visualVariant.nonvisualVariant.SKU_FOR_SWATCH.SKU_SIZE"].value} `
        : ""
    }${
      beforeFacets.s_f_binInterior_Construction_Material
        ? `${beforeFacets.s_f_binInterior_Construction_Material.value} `
        : ""
    }${curTitle[0]} ${afterFacets.join(" ")}${
      curTitle.length > 1 ? " | " + curTitle.at(-1) : ""
    }`;

    let desc = `${
      beforeFacets["visualVariant.nonvisualVariant.SKU_FOR_SWATCH.COLOR_GROUP"]
        ? `${beforeFacets["visualVariant.nonvisualVariant.SKU_FOR_SWATCH.COLOR_GROUP"].value} `
        : ""
    }${beforeFacets.BRAND ? `${beforeFacets.BRAND.value} ` : ""}${
      beforeFacets["visualVariant.nonvisualVariant.SKU_FOR_SWATCH.SKU_SIZE"]
        ? `${beforeFacets["visualVariant.nonvisualVariant.SKU_FOR_SWATCH.SKU_SIZE"].value} `
        : ""
    }${
      beforeFacets.s_f_binInterior_Construction_Material
        ? `${beforeFacets.s_f_binInterior_Construction_Material.value} `
        : ""
    }${curTitle[0]} ${afterFacets.join(" ")}`;

    // update the title and description
    $("title").text(title);
    // UPDATE 11.1.21 - JP - meta description comes from SEO api now.
    // $("head")
    //   .find(`meta[name="description"], meta[property="og:description"]`)
    //   .attr(
    //     "content",
    //     `Looking for the best selection and great deals on ${desc}? Shop Bed Bath & Beyond for incredible savings on ${desc} you won't want to miss.`
    //   );
  }

  plpSddZipModalRender(ampBody$) {
    /*** listen for clicks on "use current location" ***/
    // ampBody$.find(".useGpsForZipJs").on("click", async () => {
    //   if (navigator.geolocation) {
    //     navigator.geolocation.getCurrentPosition(async (position) => {
    //       try {
    //         // create the map quest API to get zip code
    //         let mapQuestZipSrc = `https://www.mapquestapi.com/geocoding/v1/reverse?key=Gmjtd%7Clu6120u8nh,2w%3Do5-lwt2l&location=${position.coords.latitude},${position.coords.longitude}`;
    //         const response = await fetch(mapQuestZipSrc);
    //         const results = await response.json();
    //         const location = results.results[0].locations[0].postalCode.slice(
    //           0,
    //           5
    //         );
    //         // ampList.find("#sddZipcode").val(location);
    //         wmPwa.amp.ampsSetState({ changeStore: { sddZipcode: location } });
    //       } catch (ex) {
    //         //alert("Error finding your location.");
    //       }
    //     });
    //   } else {
    //     alert("Geolocation is not supported by this browser.");
    //   }
    // });

    if (!wmPwa.session.isCANADA)
      ampBody$
        .find("#sddZipcode")
        .on("propertychange input", this.pwa.util.forceNumeric);
    else
      ampBody$
        .find("#sddZipcode")
        .on("propertychange input", this.pwa.util.fixCaZipcode);
  }

  /** function to set up the urls for the Did you find what you are looking for section of PLP search
   * @param {CashJsCollection} ampBody$ - AMP document body before it is attached to Host
   */
  yesNoFeedback(ampBody$) {
    // pwaOnly overrites werent returning display flex
    const feedbackCont = ampBody$.find(".feedbackCont");
    feedbackCont.removeClass("pwaOnly");

    // update urls
    const feedbackLinks = feedbackCont.find("[data-feedbackLink]");

    if (!feedbackLinks.length > 0) return;

    feedbackLinks[0].href = this.getFeedbackUrl("Yes");

    // handles adding the feedback number to the url from a user clicking no
    feedbackCont.find(".feedbackItm").on(
      "click",
      function (evt) {
        const btn = evt.target;
        feedbackCont.find("[data-feedbackLink]")[1].href = this.getFeedbackUrl(
          "No",
          btn.dataset.feedbackitm
        );
      }.bind(this)
    );
  }

  /**
   * Use this function to get composite product listing data for an item by passing the product id
   * @param {Strong} prodId  - product ID of item we want to get data from the prodList state
   * @returns undefined || Object
   */
  async getPlpItemData(prodId) {
    if (!this.pwa.session.docTests.isPLPReg.test(location.pathname)) return;
    try {
      const prodList = await this.pwa.amp.ampGetState("prodList");
      return prodList.response.docs.filter((item) => {
        return item.PRODUCT_ID == prodId;
      })[0];
    } catch (e) {
      console.warn(
        `Error getting PLP prod item data from prodList. Error: ${e}`
      );
    }
    return;
  }

  /**
   * When users navigate to a PDP from a special plp that is not the normal
   * breadcrumb path, we scrape the breadcrumb from the plp and save to the session object
   * @param {NODE} activeBody - docObjActive body element.
   * @returns {ARRAY} array of breacrumbs.
   */
  getPlpBreadcrumbs(activeBody) {
    let breadcrumbsArray = [];
    //if search page
    if (this.pwa.session.docTests.isSearchReg.test(location.pathname)) {
      let searchTerm = activeBody.querySelector(
        "#searchTitleList .catTitle"
      ).innerText;
      return (breadcrumbsArray = [
        {
          url: location.href,
          value: `Back to search results${
            searchTerm ? " for " + searchTerm : ""
          }`,
        },
      ]);
    }
    //if category page.
    if (this.pwa.session.docTests.isPLPReg.test(location.pathname)) {
      const breadcrumbsData = Array.from(
        activeBody.querySelectorAll(".breadcrumbs li")
      );
      const breadcrumbsDataLength = breadcrumbsData && breadcrumbsData.length;
      for (let i = 0; i < breadcrumbsDataLength - 1; i++) {
        breadcrumbsArray.push({
          url: breadcrumbsData[i].innerHTML.match(/href="([^"]*)/)[1],
          value: breadcrumbsData[i].outerText.toLowerCase(),
        });
      }
      //add the current page breadcrumb node.
      breadcrumbsArray.push({
        url: location.pathname,
        value:
          breadcrumbsData[breadcrumbsDataLength - 1].outerText.toLowerCase(),
      });
      return breadcrumbsArray;
    }
  }
}

// class PlpLeftTest {
//   constructor(pwa) {
//     this.pwa = pwa;

//     this.plpLeftCssMobile = /* css */ `
//     /* React uses Sanitize.css on Category and Search, but not brand.
//       Shimming brand to match */
//       *,::after,::before{
//         background-repeat: no-repeat;
//         box-sizing: inherit;
//       }
//     /* Mobile Modals */
//       .modalRight.modalRight {
//         float: right;
//         margin: 0;
//         max-width: 365px;
//         right: 0;
//         width: 80%;
//       }
//       .modalRight .modalClose {
//         background: transparent;
//         color: white;
//         left: 0;
//         position: fixed;
//         right: unset;
//       }
//       @media (min-width: 48rem) {
//         .modalRight .modalClose {
//           left: 355px;
//         }
//       }
//       .plpCtrlModalTitle {
//         font-size: 16px;
//         height: 48px;
//         margin: 0;
//       }
//       .plpSortClose {
//         display: block;
//       }
//       .filterModal .plpCtrlModalInner {
//         padding-bottom: 82px;
//       }

//     #facetUpdateList,
//     #facetsList {
//       min-height: calc(100vh - 238px);
//     }

//     /* Filter panel elements */
//       /* filter title */
//       .plpFilterHdr {
//         border-bottom-width: 1px;
//       }

//       .plpFilterBdy {
//         padding-bottom: 1px;
//       }
//       .plpFilterFtr {
//         border-top: 1px solid #d6d6d6;
//       }

//       /* Search input */
//       .plpFSIpt.plpFSIpt,
//       .plpRangeIpt.plpRangeIpt {
//         border: 1px solid #afafaf;
//         height: 3rem;
//       }
//       .plpFSIpt::placeholder,
//       .plpFSBtn,
//       .plpRangeIpt::placeholder,
//       .plpCbTxt:before,
//       .plpOptsSubOptTxt:before {
//         color: #afafaf;
//         border-color: #afafaf;
//       }

//       .plpFSIpt::placeholder,
//       .plpRangeIpt::placeholder {
//         font-size: 16px;
//         font-weight: normal;
//         text-transform: lowercase;
//       }
//       .plpRangePr~label {
//         padding: 4px 0 0 10px;
//       }

//       /* facet accordion */
//       #wm_content .plpOptLbl {
//         font-size: 16px;
//       }
//       .plpOptLbl:after {
//         color: #888;
//       }
//       .cbh:checked~.plpOptLbl:after {
//         background: #888;
//       }
//       .SITE_IDopt {
//         display: none;
//       }

//       /* Checkboxes */
//       .plpOpt {
//         border-top-width: 1px;
//       }
//       .plpOptsSubOpt {
//         padding-left: 1rem;
//       }
//       li.plpOptsSubOpt:nth-of-type(1),
//       span.plpOptsSubOpt:nth-of-type(1) {
//         padding-top: 0;
//       }

//       .prodBopisLbl:before,
//       .plpCbTxt:before,
//       .plpOptsSubOptTxt:before {
//         border: 1.5px solid #d6d6d5;
//         border-radius: 2px;
//       }

//     /* Sort Panel elements */
//       .plpOpt .sort {
//         font-size: 16px;
//         font-weight: 400;
//         height: 48px;
//         padding-left: 0;
//       }
//       .plpOpt .sort[disabled],
//       .plpV2 .sortOpts .sort[disabled],
//       .plpV2 .sortOpts .sort:hover {
//         background: none;
//         color: #1377c9;
//         text-decoration: underline;
//       }
//       .plpOpt:last-child {
//         border-bottom: 1px solid #d6d6d6;
//       }

//     /* Main page content */
//     .plpSecond {
//       background: #f7f7f8;
//     }

//     /* title */
//     #searchTitleList {
//       min-height: 1px;
//     }
//     .searchTitleLeft {
//       min-height: 24px;
//     }


//     /* Bopis & SDD */
//       .plpBopisSddWrap {
//         padding: 0 4%;
//       }
//       .prodBopisLbl .green {
//         color: #000;
//       }
//       .highlight2 {
//         /* color: #147bd1; */
//         color: var(--btnPri);
//       }
//       .localModalToggle.localModalToggle {
//         font-weight: 400;
//       }
//       .sfChangeBtn > div {
//         line-height: 1.2;
//         margin-bottom: 0.5rem;
//       }

//     /* Facet Buttons & Pills */
//       #plpPills::after,
//       #plpPills::before  {
//         background: linear-gradient(to right, #f7f7f800, #f7f7f8 97%);
//         content: "";
//         display: block;
//         height: 100%;
//         position: absolute;
//         right: 0;
//         top: 0;
//         width: 20px;
//         z-index: 1;
//       }
//       #plpPills::before  {
//         background: linear-gradient(to left, #f7f7f800, #f7f7f8 97%);
//         left: 0;
//         right: unset;
//       }
//       .plpControlBtn {
//         color: #000;
//       }
//       .plpPills {
//         width: 108%;
//       }
//       .plpBopisSddWrap .btnLink,
//       .plpPillClrAll {
//         color: #333;
//         font: 500 var(--txtSm)/36px var(--fontMain);
//         text-decoration: underline;
//       }
//       .plpPill {
//         align-items: center;
//         background: var(--btnPri);
//         border: none;
//         border-radius: 16px;
//         display: flex;
//         justify-content: center;
//         line-height: 1;
//         margin: 4px;
//         min-height: 32px;
//         padding: 0 6px 0 12px;
//       }
//       .plpPill .ratingBackdrop {
//         fill: var(--btnPri);
//       }
//       /*.plpPill .ratingOverlay {
//         background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="15" width="79" viewBox="0 0 79 15"><path d="M7.5 11.85l-4.4 2.28.8-4.88L.37 5.78l4.9-.74L7.5.62l2.22 4.42 4.9.74-3.52 3.47.8 4.88M39.5 11.85l-4.4 2.28.8-4.88-3.53-3.47 4.9-.74L39.5.62l2.22 4.42 4.9.74-3.52 3.47.8 4.88M23.5 11.85l-4.4 2.28.8-4.88-3.53-3.47 4.9-.74L23.5.62l2.22 4.42 4.9.74-3.52 3.47.8 4.88M55.5 11.85l-4.4 2.28.8-4.88-3.53-3.47 4.9-.74L55.5.62l2.22 4.42 4.9.74-3.52 3.47.8 4.88M71.5 11.85l-4.4 2.28.8-4.88-3.53-3.47 4.9-.74L71.5.62l2.22 4.42 4.9.74-3.52 3.47.8 4.88" fill="%23fff"></path></svg>') no-repeat;
//       }*/
//       .plpPillRating .txtPrimary,
//       .plpPillRating .ratingClr {
//         color: #fff;
//       }
//       .plpPillClr {
//         margin: 0.25rem;
//         transform: rotate(45deg);
//       }
//     `;

//     // .plpV2 necessary for experiment specificity.
//     // remove on intergration
//     this.plpLeftCssDesktop = /* css */ `
//       @media (min-width: 48rem) {
//         .plpV2 .prodListW {
//           margin: 0;
//         }
//         .plpBopisSddWrap {
//           padding: 0;
//         }
//       }
//       @media (min-width: 64rem) {

//         /* Title */

//         /* Title & Pills */
//         .catSubTitle {
//           margin-top: 2rem;
//         }
//         .plpV2 .rsSearchList {
//           margin-top: 0;
//         }
//         .searchHeroModuleCont > .searchHeroModule {
//           margin-top: 1rem;
//         }

//         /* Pills */
//         .plpV2 .plpPills {
//           padding-top: 0;
//         }

//         /* Pills */
//         #plpPills::after,
//         #plpPills::before {
//           content: none;
//         }
//         .plpV2 .plpPills {
//           margin: 28px 0 0;
//           padding-left: 4px;
//         }
//         #plpPills .hScrollList {
//           flex-wrap: wrap;
//         }
//         .hScrollList:before {
//           content: none;
//         }
//         .plpPillClrAll {
//           margin: 4px;
//         }

//         /* Sorting */
//         .plpV2 .plpControlBtnsWrap {
//           border-top: none;
//           padding-top: 2rem;
//         }
//         .plpV2 .plpControlBtns {
//           display: block
//         }
//         .plpV2 .plpControlBtns .plpControlBtn {
//           min-height: 48px;
//           padding: 0.5rem;
//           position: absolute;
//           right: 0;
//           width: 112px;
//         }
//         .plpControlBtn {
//           min-height: 48px;
//         }
//         .plpControlBtn svg {
//           margin: 0.3em;
//           color: #888;
//           transition: transform 0.4s;
//           will-change: transform;
//         }

//         .plpV2 .plpSortModal.plpSortModal,
//         .plpV2 .plpOptsAbs.sortOpts {
//           border: unset;
//           bottom: unset;
//           height: unset;
//           left: unset;
//           max-height: unset;
//           overflow: hidden;
//           position: absolute;
//           top: 56px;
//           width: 268px;
//           z-index: 10;
//         }
//         .plpV2 .sortOpts .sort {
//           border-top: 1px solid #d6d6d6;
//           padding: 0.5rem 0;
//         }

//         /* Left Filters */
//         .facetWrap {
//           padding-right: 0.5rem;
//         }

//         /* Filter Sidebar */
//         .plpV2 .filterModal,
//         .plpV2 .filterModal .modalContent {
//           background: transparent;
//           display: block;
//           height: fit-content;
//           left: unset;
//           max-width: 235px;
//           /* min-height: 150vh; */
//           overflow-y: auto;
//           position: relative;
//           right: unset;
//           width: 100%;
//           z-index: 0;
//         }

//         /* Line up loading indicators, support single-row product card layout */
//         .plpV2 .filterModal,
//         .plpV2 .filterModal .modalContent,
//         #facetUpdateList,
//         #facetsList,
//         .facetListWrap,
//         .facetUpdateList {
//           min-height: 400px;
//         }

//         .plpV2 .filterModal .plpCtrlModalInner {
//           margin: 0;
//         }
//         .plpV2 .plpFilterBdy {
//           margin: 1rem 0;
//           padding: 0;
//         }
//         .plpV2 .plpFilterHdr,
//         .plpV2 .plpFilterFtr,
//         .plpV2 [data-test="plpFilterResultsBtn"] {
//           display: none;
//         }
//         .plpFilterBdy .plpFSIpt {
//           background: #fff;
//         }
//         #facetsList .whiteBg {
//           background: #f7f7f8;
//         }
//         .BRANDopt .plpOptInptWrap,
//         .LOW_PRICEopt .plpOptInptWrap {
//           height: 48px;
//           left: 0;
//           position: absolute;
//           right: 0;
//           top: 48px;
//           z-index: 1;
//         }
//         .cbh:checked~.plpOptLbl:after {
//           margin: 0;
//         }
//         .cbh:checked~.plpOptsSub {
//           display: block;
//           line-height: 1.3;
//           margin-bottom: 1.5rem;
//           max-height: 8.5rem;
//           overflow-y: auto;
//           padding-bottom: 0;
//         }
//         .plpFacetOverflow.plpFacetOverflow {
//           min-height: 29px;
//         }
//         .plpFacetOverflow .loadBackground {
//           margin: 0.5rem 1rem 0;
//         }

//         /* Custom Scrollbars */
//         .plpV2 .plpOptsSub::-webkit-scrollbar {
//           background-color: #f7f7f8;
//           border-radius: 2px;
//           width: 4px;
//         }
//         .plpV2 .plpOptsSub::-webkit-scrollbar-thumb {
//           background-color: #000000;
//           border-radius: 2px;
//         }
//         .BRANDopt .cbh:checked~.plpOptsSub,
//         .LOW_PRICEopt .cbh:checked~.plpOptsSub {
//           margin-top: 56px;
//         }
//         /* https://em02-www.bbbyapp.com/store/category/furniture/bedroom-furniture/dressers-chests/13506/?wmPlpLeft=true&wmPwa
//           price, brand, height, width, length facets have inputs, all structured differently in DOM.
//         */
//         .BRANDopt .cbh:checked~.plpOptsSub .plpFSIpt {
//           position: absolute;
//         }

//         .plpFSIpt.plpFSIpt,
//         .plpRangeIpt.plpRangeIpt {
//           background: #fff;
//         }
//         .plpV2 .plpOptLbl,
//         .plpV2 .plpClrLbl {
//           align-items: center;
//           display: flex;
//           min-height: 48px;
//           line-height: 1.25;
//         }
//         .cbh:checked~.plpClrLbl {
//           display: flex;
//         }
//         .plpOptLabel::after {
//           margin-bottom: 1px;
//         }
//         .plpCb {
//           margin: 0;
//           min-height: 20px;
//           min-width: 20px;
//         }
//         .plpCb:checked~div:after,
//         .sfItm .plpCb:checked~.plpCbTxt:after {
//           border-bottom: 2px solid;
//           border-left: 2px solid;
//           color: #fff;
//           content: "";
//           display: inline-block;
//           height: 7px;
//           left: 4px;
//           position: absolute;
//           top: calc(50% - 6px);
//           transform: rotate(-45deg);
//           width: 13px;
//         }
//         .plpOptsSubOptTxt {
//           font-size: 16px;
//           line-height: 1.3;
//           min-height: 20px;
//           margin-left: 8px;
//           display: flex;
//           align-items: center;
//         }
//         .plpCbTxt:before,
//         .plpOptsSubOptTxt:before {
//           box-sizing: border-box;
//           height: 20px;
//           width: 20px;
//           top: calc(50% - 10px);
//         }

//         /* sort dropdown */
//         .plpSortModal,
//         .plpV2 .sortOpts {
//           background-color: #fff;
//           border-radius: 4px;
//           border: solid 1px #f2f2f2;
//           box-shadow: 2px 4px 7px 0 rgba(0, 0, 0, 0.23);
//           width: 268px;
//           z-index: 10;
//         }
//         .plpSortModal .modalRight {
//           width: 100%;
//         }
//         .plpV2 .sortOpts .plpOpt {
//           padding: 0 1rem;
//         }
//         .plpSortModal .plpOpt:first-child,
//         .plpV2 .sortOpts .plpOpt:first-child .sort  {
//           border-top: none;
//         }
//         .plpSortModal .plpOpt:last-child {
//           border-bottom: none;
//         }

//         /* SDD & Bopis */
//         .plpV2 .plpBopisSddBtns {
//           justify-content: flex-start;
//         }
//         .plpV2 .plpBopisSddList {
//           max-height: unset;
//         }
//         .plpV2 .sddZipModalList {
//           right: unset;
//         }
//         .storeFilter {
//           top: 114px;
//         }

//         /* Product Cards */
//         #plpListInner {
//           margin-right: -8px;
//           min-height: 612px;
//         }

//       }
//     `;
//   }

//   /**
//    * Open first three facet panels on first desktop page load
//    * @param {CashJsCollection} ampDoc$ - jQuery-like Amp document
//    */
//   async _open3facets(facetAmpList$) {
//     // Desktop Left Rail condition check
//     if (!facetAmpList$.is("#facetsList")) return;

//     const apiUrl = await this.pwa.amp.ampGetState("apiUrl");

//     if (Object.keys(apiUrl.facets || {}).length && !this.firstLoad) return;

//     facetAmpList$
//       .find(".plpOpt input.cbh")
//       .slice(0, 3)
//       .attr("checked", "true")
//       .addClass("active");

//     this.firstLoad = false;
//   }

//   /**
//    * Replace search term in facetOverflow API call on search pages
//    * trigger facet overflow lists
//    */
//   _plpFacetsPostRender(facetAmpList$) {
//     if (!facetAmpList$.is("#facetsList")) return;

//     let facetOverflows = facetAmpList$.find("[data-plp-facet-overflow]");
//     if (!facetOverflows.length) return;

//     // // Manually trigger amp-list on intersection
//     // JW - 1.9.22 - This appears to be necessary when filtering brands on pages with brand overflow
//     // ex: https://www.bedbathandbeyond.com/store/s/blue
//     this.pwa.intersectHandlersRegister(
//       "facetOverflow",
//       facetAmpList$,
//       "[data-plp-facet-overflow]",
//       this.pwa.amp.ampListLayoutNudge
//     );

//     // Replace search term in facetOverflow API call.
//     if (!this.pwa.session.docTests.isSearchReg.test(location.pathname)) return;
//     this.pwa.amp.ampBeforeRenderReplaceSearchTerm(
//       facetAmpList$,
//       location.pathname
//     );
//   }

//   /**
//    * Checks a facet if the facet has previously been checked in in apiUrl.
//    * This is to reduce [amp-bind] expression limit on PLP
//    */
//   async _plpFacetOverflowPostRender(facetOverflowAmpList$) {
//     if (!facetOverflowAmpList$.is("[data-plp-facet-overflow]")) return;

//     // get facets from parent list
//     const facets = {};
//     const numReg = /\(.*/gi;
//     const parentFacetList = facetOverflowAmpList$.closest(".plpOptsSub");
//     parentFacetList
//       .children()
//       .filter(".plpOptsSubOpt")
//       .each((i, e) => {
//         facets[(e.textContent.replace(numReg, "") || "").trim()] = 1;
//       });

//     // get user-selected facets
//     const apiUrl = await this.pwa.amp.ampGetState("apiUrl");

//     facetOverflowAmpList$.find(".plpCb").each((i, facetCb) => {
//       let id = facetCb.getAttribute("data-id");
//       let value = facetCb.getAttribute("data-value");

//       // remove if duplicate
//       if (facets[value]) return facetCb.parentElement.remove();

//       // check if user selection
//       if (
//         id &&
//         value &&
//         (apiUrl.facets[id] || []).filter(
//           (val) => val == `"${value.replace(/"/, '\\"')}"`
//         ).length
//       )
//         facetCb.setAttribute("checked", true);
//     });
//   }

//   /**
//    * Hide brand facets as the user types in the "find a brand" facet filter
//    * triggered via data-change-handler or data-click-handler callbacks.
//    *
//    * Moved this to a pwa-only feature to reduce [amp-bind] load
//    */
//   filterBrands() {
//     const brandSearchInput = $(wmPwa.session.docObjActive.shadowBody).find(
//       "#brandFilterInput"
//     );
//     const brandSearchTerm = (brandSearchInput.val() || "").toLowerCase();

//     const brandSearchWrap = brandSearchInput.closest(".BRANDopt");
//     brandSearchWrap.find(".plpOptsSubOpt").each((i, brandFacet) => {
//       if (
//         !brandSearchTerm ||
//         brandFacet.textContent.toLowerCase().includes(brandSearchTerm)
//       )
//         brandFacet.hidden = false;
//       else brandFacet.hidden = true;
//     });
//   }

//   // https://www.bedbathandbeyond.com/store/category/curtains-window/curtain-panels/16229
//   // Check 80" L in quote overflow.
//   // Handles all overflow facet clicks since this is a PWA only feature.
//   async facetOverflowClickHandler(argsString, target$, evt) {
//     let [facet, value] = argsString.split(",");

//     value = `"${value.trim().replace(/"/gi, `\\"`)}"`;
//     const apiUrl = await this.pwa.amp.ampGetState("apiUrl");
//     const obj = {
//       apiUrl: {
//         facets: {},
//       },
//     };
//     obj.apiUrl.facets[facet] = target$[0].checked
//       ? (apiUrl.facets[facet] || []).concat(value)
//       : apiUrl.facets[facet].filter((val) => val != value).length
//       ? apiUrl.facets[facet].filter((val) => val != value)
//       : null;
//     await this.pwa.amp.ampsSetState(obj);
//   }

//   /**
//    * PLP Left amp-list post render functions
//    * @param {CashJsCollection} ampList$ - jQuery-like Amp document
//    */
//   plpLeftAmpListPostRender(ampList$) {
//     if (!(this.pwa.session.features.plpLeft && this.pwa.desktop.isDesktop))
//       return;
//     this._open3facets(ampList$);
//     this._plpFacetsPostRender(ampList$);
//     this._plpFacetOverflowPostRender(ampList$);
//     if (ampList$.is("#plpFacetOverflowList_BRAND")) this.filterBrands();
//   }

//   /**
//    * Creates left-side PLP test before appending PLP to DOM.
//    * @param {CashJsCollection} ampDoc$ - jQuery-like Amp document
//    * @param {URL} urlObj - URL object of page to be loaded
//    * @returns undefined
//    */
//   plpLeftBeforeRender(ampDoc$, urlObj) {
//     // Feature enabled test
//     const session = this.pwa.session;
//     const docTests = session.docTests;
//     const path = urlObj.pathname;
//     if (
//       (!docTests.isPLPReg.test(path) && !docTests.isSearchReg.test(path)) ||
//       docTests.isCLPReg.test(path) ||
//       !session.features.plpLeft
//     )
//       return;

//     // Used by this.open3Facets()
//     this.firstLoad = true;

//     // TODO - remove this fn and subFns after plpV2 rebuild.
//     // this.plpBeforeRenderShimV1(ampDoc$);
//   }

//   /**
//    * Creates left-side PLP test mobile and Tablet View before appending PLP to DOM.
//    * @param {CashJsCollection} ampDoc$ - jQuery-like Amp document
//    * @returns undefined
//    */
//   // plpLeftBeforeRenderDesktop(ampDoc$) {
//   //   ampDoc$.find("body").addClass("plpV2");

//   //   ampDoc$.find("style[amp-custom]").each((i, ampCustomStyle) => {
//   //     ampCustomStyle.innerHTML += this.plpLeftCssDesktop;
//   //   });

//   //   // Hide things
//   //   ampDoc$
//   //     .find(".dskFacetsWrap, .dskPlpControlBtns, #dskFacetsTemplate")
//   //     .remove();

//   //   // List header and controls
//   //   ampDoc$.find(".plpControlHdr").removeClass("d5 dw6").addClass("d3");
//   //   ampDoc$.find(".plpPills").addClass("d7");

//   //   // Sort Dropdown
//   //   ampDoc$.find('[data-test="plpSortResultsBtn"]').addClass("dHide").after(`
//   //       <button
//   //         class="flex midCtr wHide dShow plpControlBtn"
//   //         on="tap:AMP.setState({plpModals: {dskSort: true}})"
//   //         data-test="plpSortResultsBtnDsk"
//   //       >
//   //         <div>Sort By</div>
//   //         <svg
//   //           [class]="'wi wiArrowDown plpSortChev ' + (plpModals.dskSort ? 'deg180' : '')"
//   //           class="wi wiArrowDown plpSortChev "
//   //         ><use xlink:href="#menuArrowDown"></use></svg>
//   //       </button>
//   //     `);
//   //   ampDoc$
//   //     .find(".dskPlpOptBtn.btnOutlineGreyDark")
//   //     .attr("class", "flex midCtr wHide dShow plpControlBtn");
//   //   ampDoc$
//   //     .find(".plpControlBtns")
//   //     .addClass("parent")
//   //     .append(ampDoc$.find(".plpSortModal"));
//   //   ampDoc$
//   //     .find(
//   //       `
//   //           .plpLeft .plpSortClose,
//   //           .plpLeft .plpSortFtr
//   //         `
//   //     )
//   //     .addClass("dHide");
//   //   let sortModal = ampDoc$.find(".plpSortModal").attr({
//   //     "data-amp-bind-class": `
//   //       "modal plpSortModal " + ((plpModals.sort || plpModals.dskSort) ? "active" : "")
//   //       `,
//   //   });
//   //   sortModal.find(".sort").each((i, e) => {
//   //     let sortOpt = $(e);
//   //     let on = sortOpt.attr("on");
//   //     if (!on) return;
//   //     sortOpt.attr("on", on.replace("}})", "},plpModals: {dskSort: null}})"));
//   //   });
//   //   ampDoc$.find("body").append(`
//   //       <div
//   //         tabindex="-1"
//   //         role="dialog"
//   //         on="tap:AMP.setState({plpModals: { dskSort: null } })"
//   //         class="fill plpDskSortOverlay hide"
//   //         [class]="'fill plpDskSortOverlay ' + (
//   //           plpModals.dskSort
//   //           ? ''
//   //           : 'hide'
//   //         )"
//   //       ></div>
//   //     `);

//   //   // PLP pills
//   //   let pillsMobile = ampDoc$.find("#plpPillsUpdate");
//   //   pillsMobile.attr({
//   //     height: "40px",
//   //     media: "(max-width: 1023px)",
//   //   });
//   //   let pillsDesktop = pillsMobile.clone();
//   //   pillsDesktop.attr({
//   //     height: "80px",
//   //     media: "(min-width: 1024px)",
//   //   });
//   //   pillsMobile.after(pillsDesktop);

//   //   ampDoc$
//   //     .find(".plpControlBtnsWrap")
//   //     .attr("class", "s12 d2 parent plpControlBtnsWrap");

//   //   ampDoc$.find("#plpBopisSddList").attr("height", "118px");
//   //   $(this.pwa.$$$(ampDoc$[0], ".prodBopis, .prodSDD"))
//   //     .closest(".plpBopisSddBtns")
//   //     .removeClass("dskNoWrap");

//   //   // Left Column layout
//   //   let prodListWrap = ampDoc$.find(".prodListW");
//   //   let prodListChildren = prodListWrap.children().remove();
//   //   prodListWrap.addClass("flex wrap").html(`
//   //     <div class="s12 d3 facetWrap"></div>
//   //     <div class="s12 d9 listWrap"></div>
//   //     `);
//   //   prodListWrap
//   //     .find(".facetWrap")
//   //     .append(ampDoc$.find(".plpBopisSddWrap").removeClass("d7 dw7"))
//   //     .append(ampDoc$.find(".filterModal").addClass("leftFilter"));
//   //   prodListWrap.find(".listWrap").append(prodListChildren);
//   //   $(this.pwa.$$$(ampDoc$[0], ".prodCardWrap")).removeClass("d3");

//   //   // Mobile product list
//   //   if (this.pwa.desktop.isDesktop)
//   //     ampDoc$.find("#plpListInner")[0].removeAttribute("[hidden]");
//   // }

//   /**
//    * Creates left-side PLP test mobile and Tablet View before appending PLP to DOM.
//    * @param {CashJsCollection} ampDoc$ - jQuery-like Amp document
//    * @returns undefined
//    */
//   // plpLeftBeforeRenderMobileTablet(ampDoc$) {
//   //   ampDoc$.find("style[amp-custom]").each((i, ampCustomStyle) => {
//   //     ampCustomStyle.innerHTML += this.plpLeftCssMobile;
//   //   });

//   //   // Header
//   //   ampDoc$.find(".catSubTitle").removeClass("vb05").addClass("v0 vt1");
//   //   ampDoc$
//   //     .find(".plpBopisSddWrap")
//   //     .removeClass("v1 dw6")
//   //     .addClass("vt05 vb15");

//   //   /* Move Search title into the left panel */
//   //   ampDoc$.find("#searchHeroModule").removeClass("vb1");

//   //   let resultCountList = ampDoc$
//   //     .find("#resultsCountList")
//   //     .removeClass("v05")
//   //     .addClass("vb15")[0];

//   //   resultCountList.insertAdjacentHTML(
//   //     "beforebegin",
//   //     /*html*/ `
//   //       <amp-list
//   //         binding="always"
//   //         class="variableAmpList"
//   //         height="24px"
//   //         id="searchTitleLeft"
//   //         items="."
//   //         layout="fixed-height"
//   //         single-item
//   //         src="amp-state:prodList"
//   //       >
//   //         <template type="amp-mustache">
//   //           {{#fusion}}
//   //             <h1 class="catSubTitle vb05 title"
//   //                 data-search-replace="text"
//   //             >
//   //               {{q}}
//   //             </h1>
//   //             {{#org_q}}
//   //                 <p class="txtCtr" hidden [hidden]="'{{org_q}}' == '{{q}}'">We found 0 results for &ldquo;{{org_q}}&rdquo;, so we changed it to &ldquo;{{q}}&rdquo;.</p>
//   //             {{/org_q}}
//   //           {{/fusion}}
//   //         </template>
//   //       </amp-list>
//   //     `
//   //   );
//   //   /* end Move Search title into the left panel */

//   //   // Facet Buttons & Pills
//   //   ampDoc$
//   //     .find(".plpControlBtnsWrap")
//   //     .after(ampDoc$.find(".plpPills").addClass("s12 vt05"));
//   //   ampDoc$.find("#plpListInner").removeClass("v1").addClass("vb1");
//   //   $(this.pwa.$$$(ampDoc$[0], '.plpPill, [data-test="inStockPill"]')).addClass(
//   //     "midCtr"
//   //   );

//   //   const plpPillClrAll = $(this.pwa.$$$(ampDoc$[0], ".plpPillClrAll"));
//   //   plpPillClrAll.addClass("btnLink");
//   //   const pillsTemplate = plpPillClrAll.closest(".hScrollList");
//   //   pillsTemplate.append(pillsTemplate.find(".plpPillClrAll"));

//   //   // SDD & BOPIS
//   //   $(this.pwa.$$$(ampDoc$[0], ".prodBopis")).addClass("s12 t6 d12");
//   //   $(
//   //     this.pwa.$$$(ampDoc$[0], '.prodBopisLbl[for="prodSdd"] .uppercase')
//   //   ).addClass("highlight2");
//   //   $(
//   //     this.pwa.$$$(ampDoc$[0], '.prodBopisLbl[for="prodSdd"] .green')
//   //   ).removeClass("gr025");
//   //   $(
//   //     this.pwa.$$$(
//   //       ampDoc$[0],
//   //       '.prodBopisLbl[for="prodBopisCbPwa"] span:last-child'
//   //     )
//   //   )
//   //     .before(
//   //       `
//   //       <span class="noTap">at</span>
//   //       <span
//   //         data-amp-bind-text="storeInfo.data.store.commonName + (
//   //           (changeStore.nearestStores && changeStore.nearestStores.length)
//   //             ? ' and nearby stores'
//   //             : ''
//   //         )"
//   //         class="noTap highlight2"
//   //       ></span>
//   //     `
//   //     )
//   //     .remove();

//   //   // Mobile Modals
//   //   ampDoc$
//   //     .find(".plpSortFtr")
//   //     .attr("class", "v1 dHide")
//   //     .closest(".modal")
//   //     .addClass("plpSortModal")
//   //     .removeAttr("[class]")
//   //     .attr(
//   //       "data-amp-bind-class",
//   //       '"modal plpSortModal " + (plpModals.sort ? "active" : "")'
//   //     )
//   //     .find("h2")
//   //     .text("Sort By")
//   //     .attr("class", "midCtr plpSortTitle plpCtrlModalTitle dHide");
//   //   ampDoc$
//   //     .find("#facetUpdateList, #facetsList")
//   //     .attr("reset-on-refresh", "1")
//   //     .addClass("loadBlockList");
//   //   ampDoc$
//   //     .find(
//   //       `
//   //       .filterModal .modalContent,
//   //       .plpSortModal .modalContent,
//   //       .plpFilterFtr
//   //       `
//   //     )
//   //     .addClass("modalRight");
//   //   ampDoc$
//   //     .find(".filterModal, .plpSortModal")
//   //     .attr(
//   //       "on",
//   //       "tap:AMP.setState({plpModals: {dskFilter: false, filter: false, sort: false}})"
//   //     )
//   //     .find(".modalContentInner")
//   //     .attr({
//   //       class: "plpCtrlModalInner g1",
//   //       on: "tap:AMP.setState({preventDefault: !preventDefault})",
//   //     });

//   //   // mobile filter panel elements
//   //   ampDoc$
//   //     .find(".plpFilterHdr")
//   //     .addClass("ctr plpCtrlModalTitle")
//   //     .find("h2")
//   //     .before(
//   //       `<div class="bold" [text]="'Filter' + ( prodList.appliedFacets.length ?  ' (' + prodList.appliedFacets.length + ')' : '' )"></div>`
//   //     )
//   //     .remove();
//   //   // search
//   //   ampDoc$.find(".plpFSBtn svg path").removeAttr("stroke");
//   //   // brand filter
//   //   $(this.pwa.$$$(ampDoc$[0], '[placeholder="Find a Brand"]'))
//   //     .parent()
//   //     .addClass("vb05")
//   //     .find("svg path")
//   //     .removeAttr("stroke");
//   //   // price and size ranges
//   //   $(this.pwa.$$$(ampDoc$[0], ".plpFilterRange")).attr(
//   //     "class",
//   //     "plpFilterRange flex just vb05"
//   //   );

//   //   // Make Panels independent
//   //   $(this.pwa.$$$(ampDoc$[0], '.plpOpt [name="filterOptns"]')).each(
//   //     (i, facetToggle) => {
//   //       let inStockOnline = facetToggle.id == "inStockOnline";
//   //       facetToggle.removeAttribute("[checked]");
//   //       $(facetToggle).attr({
//   //         "data-amp-bind-checked": `
//   //           (apiUrl.activeFacetIds || []).includes("{{id}}")
//   //           || keys(apiUrl.facets || {}).includes("{{id}}") ${
//   //             inStockOnline
//   //               ? "|| (apiUrl.inStockOnline || '').indexOf('true') != -1"
//   //               : ""
//   //           }`,
//   //         name: "{{id}}",
//   //         id: "{{id}}",
//   //         on: `change:AMP.setState({
//   //           apiUrl: {
//   //             activeFacetIds: (
//   //               event.checked
//   //                 ? (apiUrl.activeFacetIds || []).concat("{{id}}")
//   //                 : (apiUrl.activeFacetIds || []).filter(id => id != "{{id}}")
//   //             ) ${
//   //               inStockOnline
//   //                 ? `removeInStock: (event.checked ? '' : apiUrl.removeInStock),
//   //                 inStockOnline: (event.checked ? '&inStockOnline=true' : '')`
//   //                 : ""
//   //             }
//   //             }
//   //         })`,
//   //         type: "checkbox",
//   //       });
//   //     }
//   //   );
//   //   let plpOptsSub = $(this.pwa.$$$(ampDoc$[0], ".plpOptsSub")).addClass(
//   //     "parent"
//   //   );
//   //   plpOptsSub
//   //     .find(".plpFSIpt, .plpFilterRange")
//   //     .parent()
//   //     .addClass("plpOptInptWrap");
//   //   $(this.pwa.$$$(ampDoc$[0], '.plpClrLbl, label[for="inStockOnline"]')).each(
//   //     (i, facetToggleLabel) => {
//   //       $(facetToggleLabel).attr({
//   //         for: "{{id}}",
//   //       });
//   //     }
//   //   );

//   //   this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "apiUrl", {
//   //     activeFacetIds: [],
//   //   });
//   // }

//   /**
//    * Creates left-side PLP test mobile and Tablet View before appending PLP to DOM.
//    * @param {CashJsCollection} ampDoc$ - jQuery-like Amp document
//    * @returns undefined
//    */
//   // plpBeforeRenderShimV1(ampDoc$) {
//   //   if (ampDoc$.find("body").hasClass("plpV2")) return;

//   //   // Shim V1 pages to match V2 pages
//   //   // Sort buttons
//   //   ampDoc$.find('[data-test="plpSortResultsBtn"]').text("Sort By");

//   //   // Mobile
//   //   this.plpLeftBeforeRenderMobileTablet(ampDoc$);

//   //   // Desktop
//   //   this.plpLeftBeforeRenderDesktop(ampDoc$);
//   // }

//   // handle plp specific param routing ie Amp-user-journey
//   // this function assumes only one of these things can be true at a time
//   async plpParamRouter(params, paramval, urlObj) {
//     await this.pwa.util.waitForProp("docObjActive", this.pwa.session);
//     let state = {};
//     let url = new URL(urlObj.href);

//     // open modal based off which action is passed
//     if (params.modal) {
//       state.plpModals = {};
//       state.plpModals[params.modal] = true;

//       // handle other amp state condition of filter btn click
//       if (params.modal == "filter") {
//         let apiUrl = await this.pwa.amp.ampGetState("apiUrl");
//         state.apiUrl = {
//           activeFacetIds: apiUrl.activeFacetIds.length
//             ? apiUrl.activeFacetIds
//             : (apiUrl.activeFacetIds || []).concat(Object.keys(apiUrl.facets)),
//         };
//       }
//     }

//     if (params.btn) {
//       let apiUrl = await this.pwa.amp.ampGetState("apiUrl");
//       // user clicks on in stock pill on AMP
//       if (params.btn == "pill") {
//         state.apiUrl = {
//           inStockOnline: "",
//           removeInStock: "&removeInStock=true",
//           page: 0,
//           pageParam: "&start=0&perPage=" + apiUrl.perPage,
//         };
//         url.searchParams.set("removeInStock", "true");
//       }

//       // someone clicks on bopis label on AMP
//       // runs off of plpItmCt which may be updated later, currently 24
//       if (params.btn == "bopisLbl") {
//         let [storeInfo, changeStore] = await Promise.all([
//           this.pwa.amp.ampGetState("storeInfo"),
//           this.pwa.amp.ampGetState("changeStore"),
//         ]);
//         state = {
//           apiUrl: {
//             removeInStock: "&removeInStock=true",
//             sddZipParam: "",
//             page: 0,
//             pageParam: "&start=0&perPage=24",
//             storeOnlyParam:
//               "&storeOnlyProducts=true&storeId=" +
//               (storeInfo.data.store.storeId || ""),
//           },
//           changeStore: {
//             nearestStores: changeStore.nearestStores,
//             sddActive: false,
//             sddActiveSearch: false,
//             storeId: storeInfo.data.store.storeId || "",
//             storeOnly: true,
//           },
//         };
//         url = new URL(
//           `${urlObj.origin}${urlObj.pathname}${
//             storeInfo.data.store.storeId
//               ? `/store-${storeInfo.data.store.storeId}`
//               : ""
//           }`
//         );
//         url.searchParams.set("removeInStock", "true");
//       }

//       // someone clicks on change or add stores button on AMP
//       if (params.btn == "changeStore") {
//         state.u = {
//           storeFilter: true,
//         };
//       }

//       // someone clicks on sdd label on AMP
//       // runs off of plpItmCt which may be updated later, currently 24
//       if (params.btn == "sddLbl") {
//         let [storeInfo, changeStore] = await Promise.all([
//           this.pwa.amp.ampGetState("storeInfo"),
//           this.pwa.amp.ampGetState("changeStore"),
//         ]);
//         state = {
//           apiUrl: {
//             removeInStock: "&removeInStock=true",
//             sddZipParam:
//               changeStore.sddZipcode.length == 5
//                 ? `&isSDDChecked=true&sddAttr=13_1&sddAttribute=13_1&sddZip=${changeStore.sddZipcode}`
//                 : `&isSDDChecked=true&sddAttr=13_1&sddAttribute=13_1&sddZip=${changeStore.sddZipcode.slice(
//                     0,
//                     3
//                   )}`,
//             page: 0,
//             pageParam: "&start=0&perPage=24",
//             storeOnlyParam:
//               "&storeOnlyProducts=false&storeId=" +
//               (storeInfo.data.store.storeId || ""),
//           },
//           changeStore: {
//             sddActive: true,
//             sddActiveSearch: true,
//             sddZipcode: changeStore.sddZipcode,
//             sddStoreId: changeStore.sddStoreId || "1",
//             nearestStores: null,
//             storeOnly: false,
//           },
//         };
//         url = new URL(
//           `${urlObj.origin}${urlObj.pathname}${
//             changeStore.sddZipcode.length == 5
//               ? `/sddZip-${changeStore.sddZipcode}`
//               : `/sddZip-${changeStore.sddZipcode.slice(0, 3)}`
//           }`
//         );
//         url.searchParams.set("removeInStock", "true");
//       }

//       // someone clicks on change zip button on AMP
//       if (params.btn == "changeZip") {
//         state = {
//           u: {
//             sddZipModal: true,
//           },
//           sddZipModalDirty: false,
//         };
//       }
//     }

//     await this.pwa.amp.ampsSetState(state);

//     // remove the search params and update url
//     url.searchParams.delete("modal");
//     url.searchParams.delete("type");
//     url.searchParams.delete("btn");
//     history.replaceState("", "", url.toString());
//   }
// }

class PencilBanner {
  constructor(pwa) {
    this.pwa = pwa;
    this.enabled = true;
    try {
      this.enabled = sessionStorage.getItem("hideTopBanner") ? false : true;
    } catch (ex) {
      // do not show banner to users in incognito no-cookie mode b/c we can't close modal properly.
      this.enabled = false;
    }
    this.appshellPencilBannerPlaceholder = $("#pencilBannerWrap");

    this.ampPencilBannerCss = `
    /* 1.15.21 moving Pencil Banner CSS into ampBeforeRender to reduce layout Shift */
    .hidePencil #headerWrap {
      transform: translateY(calc(var(--pencilBannerHeight) * -1));
    }
    .hidePencil .navWrap,
    .hidePencil .overlay {
      transform: translateY(var(--pencilBannerHeight));
    }
    .hidePencil .navWrap.catNav,
    .hidePencil .overlay.catNav {
      transform: translateY(0);
      height: calc(100vh - var(--headHeight) );
    }
    /* User has closed the pencil banner */
    .hidePencilAmp .navWrap.catNav,
    .hidePencilAmp .overlay.catNav {
      height: calc(100vh - var(--headHeight));
    }
    .hidePencilAmp .overlay.catNav {
      top: var(--headHeight);
    }
    @media (min-width: 80rem) {
      .hidePencil .navWrap,
      .hidePencil .overlay.active {
        transform: translateY(0);
        height: calc(100vh - var(--headHeight) );
      }
      .hidePencilAmp .navWrap.catNav {
        height: fit-content;
        top: calc(var(--headHeight) - 8px);
      }
      .hidePencilAmp .overlay.active {
        height: calc(100vh - var(--headHeight));
      }
    }

    #headerWrap {
      background: var(--hBackPri);
      transform: translateY(0);
      transition: transform 400ms ease-out;
      z-index: 100;
      will-change: transform;
    }
    .pencilBannerWrap {
      background-color: ${this.pwa.session.isBABY ? "#00a39b" : "#002855"};
      ${this.pwa.session.isBABY ? "border-bottom: 1px solid #3fbbb1;" : ""}
      color: #fff;
      display: table;
      font-family: var(--fontMain);
      box-sizing: border-box;
      height: var(--pencilBannerHeight);
      max-height: var(--pencilBannerHeight);
      overflow: hidden;
    }
    .tableRow {
      display: table-row;
      height: 100%;
    }
    .pencilBannerContent {
      color: #fff;
      display: table-cell;
      height: var(--pencilBannerHeight);
      line-height: 1.2;
      margin: 0;
      padding-right: var(--pencilBannerHeight);
      text-align: center;
      vertical-align: middle;
      width: 100%;
    }
    .pencilBannerContent a {
        color: inherit;
    }
    .btn.pencilBannerClose {
      background: none;
      border: none;
      padding: .5rem;
      position: absolute;
      right: 0;
      top: 0;
      color: currentColor;
      height: var(--pencilBannerHeight);
    }
    #pencilObserver {
        display: block;
        position: relative;
        height: var(--pencilBannerHeight);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
    }
    .pencilSpacer,
    .pencilObserver {
      height: var(--pencilBannerHeight);
    }
    .pencilSpacer {
      pointer-events: none;
    }
    @media (max-width: 767px) {
      .hidePencil #searchcontainer#searchcontainer {
        top: var(--pencilBannerHeight);
      }
    }

    /* amp-list Pencil banner  */
    #pencilBannerWrap > :first-child {
      height: var(--pencilBannerHeight);
      overflow: hidden;
      padding-right: var(--pencilBannerHeight);
    }
    `;
  }

  /**
   * Modifies the amp document to display & hide the pencilBanner.
   * @param {CashJsCollection} ampBody$ - AMP document body before it is attached to Host
   */
  ampBeforeRender(ampBody$, urlObj) {
    // do not show pencilBanner for quickview
    if (urlObj.searchParams.has("quickView")) return;

    let pencilBannerAL = ampBody$.find(".pencilBannerAL");
    // temp remove when pencil banner is up to date with content stack
    if (!pencilBannerAL.length) {
      pencilBannerAL = ampBody$.find("#pencilBannerAL");
    }

    if (pencilBannerAL.length) {
      ampBody$
        .closest("html")
        .find("style[amp-custom]")
        .each((i, ampCustomStyle) => {
          ampCustomStyle.innerHTML += this.ampPencilBannerCss;
        });

      if (!this.enabled) {
        pencilBannerAL.remove();
        ampBody$.find("#pencilBannerTemplate").remove();
        ampBody$.addClass("hidePencilAmp");
      }
    } else {
      if (!this.enabled) {
        return;
      }
      ampBody$
        .closest("html")
        .find("style[amp-custom]")
        .each((i, ampCustomStyle) => {
          ampCustomStyle.innerHTML += this.ampPencilBannerCss;
        });
      ampBody$
        .find("#headerWrap")
        .prepend(
          '<div id="pencilBanner" class="s12 midCtr pencilBannerWrap"></div>'
        );
    }

    if (this.enabled)
      ampBody$.prepend(
        '<div id="pencilObserver" class="pencilObserver"></div>'
      );
  }

  /**
   * Renders the pencil banner.
   * Modifies the amp document to display & hide the pencilBanner.
   */
  async ampPostRender(ampBody$) {
    if (!this.enabled) return;

    let pencilBannerAL = ampBody$.find(".pencilBannerAL");
    // temp remove when pencil banner is up to date with content stack
    if (!pencilBannerAL.length) {
      pencilBannerAL = ampBody$.find("#pencilBannerAL");
    }
    if (pencilBannerAL.length) {
      // native amp page pencil banner
      // Interaction handler
      pencilBannerAL.on("tap click", this.remove.bind(this));
    } else {
      // pwa only pencil banner
      // data
      let promo;
      try {
        const user = await this.pwa.amp.ampGetState("user");
        promo = user.data.LOCAL_HEADER_PROMO;
      } catch (e) {
        throw this.pwa.errorCustom(
          "Problem getting pencil data from user state",
          e
        );
      }

      if (!promo.length || !/^</i.test(promo[0])) return;

      // DOM
      ampBody$.find("#pencilBanner").removeClass("midCtr").html(`
        ${$(promo[0]).addClass("s12 pencilBannerContent").outerHTML()}`);
      ampBody$.find("#pencilBanner p").append(
        `<button
              class="midCtr btn pencilBannerClose modalCloseJs"
              aria-label="Close Marketing Banner"
            >
              <svg class="wi wiClose noTap">
                <use xlink:href="#wiClose"></use>
              </svg>
            </button>
          `
      );
      ampBody$
        .find(
          "#pencilObserver, #pencilBanner, .pencilBannerAL, #pencilBannerAL"
        )
        .remove();
      // Interaction handler
      ampBody$.find("#pencilBanner").on("tap click", this.remove.bind(this));
    }

    // Intersection observer
    // Using closure, arrow function, & native DOM methods
    // for snappier animation on scroll.
    const ampBody = ampBody$[0];
    this.pwa.intersectHandlersRegister(
      "pencilObserve",
      ampBody,
      "#pencilObserver",
      (pwa, intersectionEntry) => {
        if (intersectionEntry.intersectionRatio == 0) {
          ampBody.classList.add("hidePencil");
        } else {
          ampBody.classList.remove("hidePencil");
        }
      }
    );

    // Hide appshell placeholder
    $("#wmShellContentWrap #headerWrap").remove();
  }

  /**
   * Reserves layout space for the pencil banner in the appshell.
   */
  appshellBeforeRender() {
    this.appshellPencilBannerPlaceholder[
      this.enabled ? "removeClass" : "addClass"
    ]("hide");
  }

  /**
   * Removes the pencil banner permanently.
   * @param {Event} evt - tap or click event;
   */
  remove(evt) {
    if (!$(evt.target).is(".modalCloseJs")) return;

    // remove position observer element
    let ampBody = $(evt.currentTarget).closest("body");
    ampBody
      .find("#pencilObserver, #pencilBanner, .pencilBannerAL, #pencilBannerAL")
      .remove();
    ampBody.removeClass("hidePencil");
    ampBody.addClass("hidePencilAmp");
    ampBody[0].pencilObserve.disconnect();
    try {
      window.sessionStorage.hideTopBanner = true;
    } catch (e) {}
  }
}

/**
 * Show PDP pages in the "Quick View" modal
 */
class Quickview {
  constructor(pwa) {
    this.pwa = pwa;
    this.quickViewBtn = `
    <div class="s12 midCtr btnQuickViewWrap">
      <div class="vb05 btn btnOutlinePrimary btnQuickView">
        Quickview
      </div>
    </div>`;
    this.quickViewLoaded = false;
  }

  /**
   * Loads a PDP in the quickview modal
   * @param {clickEvent} - User's click event
   */
  quickViewOpen(evt) {
    // JW 8.17.21 - temporarily remove quickView until we can implement chooseOptions
    // TODO - Can this fn be removed alltogether?
    return;
    // JP - uncomment below code if this fn is needed again
    // this.pwa.util.stopEvent(evt);
    // let href = $(evt.target).closest(".prodCardL").find("a").attr("href");
    // if (!href) return;

    // this.pwa.quickView.quickViewLoaded = true;

    // let url = new URL(href);
    // url.searchParams.set("quickView", "true");
    // this.pwa.load(url.href);
  }

  /**
   * Closes the PDP quickview modal & focuses the PLP page
   * @param {clickEvent} evt (opt) - User's click event
   */
  quickViewClose(evt) {
    if (evt) this.pwa.util.stopEvent(evt);
    $("body").removeClass("pdpActive quickViewAppshell");
    this.quickViewLoaded = false;
  }

  /**
   * Modify PDP before Render for display in the quick view modal.
   * @param {CashJSCollection} ampBody$ - jQuery-like amp body fragment before DOM attachment
   */

  quickViewBeforeRender(ampBody$, urlObj) {
    // JW 8.17.21 - temporarily remove quickView until we can implement chooseOptions
    // TODO - Can this fn be removed?
    return;
    // JP - uncomment this code if this fn is needed again
    
    // if (!urlObj.searchParams.has("quickView")) return;

    // // Quickview state classes
    // $("body").addClass("quickViewAppshell");
    // ampBody$.addClass("quickView");

    // // Modal styling
    // ampBody$.find("#wm_content").attr("id", "wm_contentQv");
    // ampBody$.append(`
    //   <button tabindex="0"
    //     id="qvModalCloseBtn"
    //     aria-label="Close Modal"
    //     class="btn modalClose"
    //     data-modal-close=""
    //   >
    //     <svg class="wi wiClose noTap" aria-hidden="true"><use xlink:href="#wiClose"></use></svg>
    //   </button>
    // `);

    // // Remove unused elements
    // ampBody$
    //   .find(
    //     `#headerWrap,
    //     .parentCollection,
    //     .offers,
    //     .offersWrap,
    //     #wm_footer
    //     `
    //   )
    //   .attr("hidden", true);
    // ampBody$
    //   .find(
    //     `.mixedBanner,
    //     .breadcrumbs,
    //     .writeReview,
    //     #payOption,
    //     .accWrap,
    //     .collectBtnCont
    //     `
    //   )
    //   .remove();
    // ampBody$
    //   .find("#second")
    //   .nextUntil()
    //   .not("amp-state, template, #likeSolarSliderLoveThese")
    //   .remove();

    // /* re-class remaining elements */
    // ampBody$.find(".prodDetails").attr("class", "s12 flex wrap prodDetailsQv");

    // const fullUrl = new URL(urlObj.href);
    // fullUrl.searchParams.delete("quickView");
    // // product slides
    // ampBody$
    //   .find('.prodSlides:not([data-feature="pdpCgccImages"])')
    //   .attr("class", "s12 t6 prodSlidesQv");
    // $(
    //   this.pwa.$$$(
    //     ampBody$[0],
    //     `.dskClickPrompt,
    //     .prodSlide [on]`
    //   )
    // ).removeAttr("on role tabindex data-modal-open");

    // // Review Links
    // $(this.pwa.$$$(ampBody$[0], ".sliderRatingCount"))
    //   .filter((i, e) => !e.closest("[placeholder]"))
    //   .replaceWith(
    //     `<a href="${fullUrl.href}#reviews" data-cta="pdpProductReviewsClick" class="sliderRatingCount" >{{REVIEWS}} Reviews</a>`
    //   );

    // // QNA Links
    // $(this.pwa.$$$(ampBody$[0], ".qna")).replaceWith(
    //   `<a href="${fullUrl.href}#qna" data-cta="pdpProductQAClick" class="mid block proofLink qna">Product Q&A</a>`
    // );

    // // 2 Col Layout
    // let prodConfig = ampBody$
    //   .find(".prodConfig")
    //   .attr("class", "s12 t6 prodConfigQv");
    // prodConfig.find(".prodDescr").attr("class", "s12 prodDescrQv");
    // prodConfig.find(".prodBuy").attr("class", "s12 prodBuyQv");

    // // "Customers Also Checked Out Slider"
    // ampBody$
    //   .find("#likeSolarSliderLoveThese")
    //   .attr("class", "borderTop parent noLoader sliderWrap qvSliderWrap");
    // $(this.pwa.$$$(ampBody$[0], ".sliderHeader"))
    //   .removeClass("h3 txtCtr")
    //   .addClass("qvSliderHeader")
    //   .text("Customers Also Checked Out");

    // $(this.pwa.$$$(ampBody$[0], "amp-carousel")).attr("data-display-count", 5);

    // // re-arrange remaining elements
    // ampBody$
    //   .find(".prodSlidesQv .modalImg")
    //   .before(
    //     ampBody$.find(
    //       `.prodDescrQv a[href*="brand"], .prodTitle, #productScript`
    //     )
    //   );
  }

  /**
   * Modify PDP after render in the quick view modal.
   * @param {CashJSCollection} ampBody$ - jQuery-like amp body fragment after DOM attachment
   */

  quickViewPostRender(ampBody$) {
    // JW 8.17.21 - temporarily remove quickView until we can implement chooseOptions
    return;
    // JP - uncomment below code if this fn is needed again
    // ampBody$
    //   .find("#qvModalCloseBtn")
    //   .on("click", this.quickViewClose.bind(this));
  }
}

class FindMyCollege {
  constructor(pwa) {
    this.enabled = false;
    this.pwa = pwa;
    const urlCollegesByState =
      location.origin + "/apis/stateless/v1.0/college/colleges-by-state/";
    const urlCollegeData =
      location.origin +
      "/apis/stateless/v1.0/college/colleges-by-id/?college_id=";
    this.ampFindMyCollegeCss = /*css*/ `
      .findMyCollegeCont {
        margin: 2rem auto;
      }
      .findMyCollegeCont .radItm:hover {
        background-color: #d6d6d6;
      }
      .findMyCollegeBtn {
        height: 50px;
      }
    `;

    this.collegeSelector = /*html*/ `
    <amp-state id="collegeInfo" src="" [src]="changeCollege.collegeId ? '${urlCollegeData}' + changeCollege.collegeId : ''"></amp-state>
    <amp-state id="stateNames">
      <script type="application/json">
        ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]
      </script>
    </amp-state>
    <amp-state id="schoolNames" src=""
      [src]="changeCollege.selection.stateName ? '${urlCollegesByState}' + changeCollege.selection.stateName :
      ''">
      </amp-state>

    <div class="t10 flex midCtr findMyCollegeCont">
      <span class="t3 gr05 txtCenter">find the closest store to your college</span>
      <div class="t3 gr1 clIpt">
        <button
          class="s12 txtLeft borderNone radBtn mid flex just vCtr hBet"
          on="tap:AMP.setState({changeCollege: {searchStateModal: true}})"
          data-test="csstateSearchBtn"
        >
            <span
              class="parent bold lineClamp1 txtBlk"
              style="bottom: -3px"
              [text]="changeCollege.selection.stateName || 'State'"
              >State</span
            >
          <svg
            class="vt05 vb025 gr025 wi-down-arrow"
            xmlns="http://www.w3.org/2000/svg"
            height="16"
            width="16"
            viewBox="0 0 12.01 6.15"
            style="height: 23px; margin-right: 15px; width: 14px"
          >
            <path
              fill="#8c8c8c"
              d="M6 6.15a1.07 1.07 0 01-.6-.2l-5-4.2A1 1 0 01.25.35a1 1 0 011.4-.1L6 3.85l4.4-3.6a1 1 0 011.4.1 1 1 0 01-.1 1.4L6.65 6a1.85 1.85 0 01-.65.15z"
              data-name="Filter/Arrow/Down"
            ></path>
          </svg>
        </button>
        <div
          class="s12 vp1 gp05 fill whiteBg absolute ssMRad findCollegeStateModal hide"
          [class]="'s12 vp1 gp1 fill whiteBg absolute ssMRad findCollegeStateModal ' + (changeCollege.searchStateModal ? '' : 'hide')"
        >
          <button
            class="absolute ctr txtBlk borderNone btnLink ssClose"
            on="tap:AMP.setState({changeCollege: {searchStateModal: false}})"
          >
            <svg
              class="gr025 wi-close"
              xmlns="http://www.w3.org/2000/svg"
              height="16"
              width="16"
              viewBox="0 0 10.49 10.48"
            >
              <g data-name="Layer 2">
                <path
                  d="M5.24 3.83L8.78.29a1 1 0 111.41 1.41L6.66 5.24l3.54 3.54a1 1 0 11-1.41 1.41L5.24 6.66l-3.53 3.53A1 1 0 01.29 8.78l3.54-3.54L.29 1.71A1 1 0 011.71.29z"
                  data-name="Layer 1"
                ></path>
              </g>
            </svg>
          </button>
          <div class="modalBody">
            <amp-selector
              class="
                radList
                i-amphtml-element i-amphtml-layout-container i-amphtml-built
              "
              on="select:AMP.setState({changeCollege: {
                selection:{
                  stateName: event.targetOption,
                },
                searchStateModal: false
              }})"
              i-amphtml-layout="container"
              role="listbox"
            >
              <amp-list
                layout="fixed-height"
                height="100"
                class="variableAmpList"
                src="amp-state:stateNames"
                items="."
              >
                <template type="amp-mustache">
                  <button
                    class="s12 whiteBg txtBlk txtLeft borderNone radItm"
                    option="{{.}}"
                    >{{.}}</button
                  >
                </template>
              </amp-list>
            </amp-selector>
          </div>
        </div>
      </div>
      <div class="t3 gr1 clIpt">
        <button
          class="s12 txtLeft borderNone radBtn mid flex just vCtr hBet"
          on="tap:AMP.setState({changeCollege: {searchSchoolModal: true}})"
          data-test="csstateSearchBtn"
          disabled
          [disabled]="!changeCollege.selection.stateName"
        >
            <span
              class="parent bold lineClamp1 txtBlk"
              style="bottom: -3px"
              [text]="changeCollege.schoolName || 'College'"
              >
                College
              </span>
          <svg
            class="vt05 gr025 wi-down-arrow"
            xmlns="http://www.w3.org/2000/svg"
            height="16"
            width="16"
            viewBox="0 0 12.01 6.15"
            style="
              height: 23px;
              margin-right: 15px;
              width: 14px;
            "
          >
            <path
              fill="#8c8c8c"
              d="M6 6.15a1.07 1.07 0 01-.6-.2l-5-4.2A1 1 0 01.25.35a1 1 0 011.4-.1L6 3.85l4.4-3.6a1 1 0 011.4.1 1 1 0 01-.1 1.4L6.65 6a1.85 1.85 0 01-.65.15z"
              data-name="Filter/Arrow/Down"
            ></path>
          </svg>
        </button>
        <div
          class="s12 vp1 gp05 fill whiteBg absolute ssMRad findCollegeSchoolModal hide"
          [class]="'s12 vp1 gp1 fill whiteBg absolute ssMRad findCollegeSchoolModal ' + (changeCollege.searchSchoolModal ? '' : 'hide')"
        >
          <button
            class="absolute ctr txtBlk borderNone btnLink ssClose"
            on="tap:AMP.setState({changeCollege: {searchSchoolModal: false}})"
          >
            <svg
              class="gr025 wi-close"
              xmlns="http://www.w3.org/2000/svg"
              height="16"
              width="16"
              viewBox="0 0 10.49 10.48"
            >
              <g data-name="Layer 2">
                <path
                  d="M5.24 3.83L8.78.29a1 1 0 111.41 1.41L6.66 5.24l3.54 3.54a1 1 0 11-1.41 1.41L5.24 6.66l-3.53 3.53A1 1 0 01.29 8.78l3.54-3.54L.29 1.71A1 1 0 011.71.29z"
                  data-name="Layer 1"
                ></path>
              </g>
            </svg>
          </button>
          <div class="modalBody">
            <amp-selector
              class="
                radList
                i-amphtml-element i-amphtml-layout-container i-amphtml-built
              "
              on="select:AMP.setState({changeCollege: {
                selection:{
                  schoolName: event.targetOption,
                  collegeId: schoolNames.data.colleges.filter(x=>x.collegeName == event.targetOption)[0].collegeID
                },
                searchSchoolModal: false
              }})"
              i-amphtml-layout="container"
              role="listbox"
            >
              <amp-list
                layout="fixed-height"
                height="100"
                class="variableAmpList"
                src="amp-state:empty"
                [src]="changeCollege.selection.stateName ? schoolNames.data.colleges : empty"
                single-item
              >
                <template type="amp-mustache">
                  <button
                    class="s12 whiteBg txtBlk txtLeft borderNone radItm"
                    option="{{collegeName}}"
                    collegeseoname="{{collegeSeoName}}"
                    >{{collegeName}}</button
                  >
                </template>
              </amp-list>
            </amp-selector>
          </div>
        </div>
      </div>
      <button
        class="t3 bold btn clIpt findMyCollegeBtn"
        [class]="'t3 bold btn findMyCollegeBtn' + (changeCollege.selection.schoolName ? ' btnOutlinePrimary' : ' clIpt')"
        disabled [disabled]="!changeCollege.selection.schoolName"
        on="tap:AMP.setState({
          changeCollege: changeCollege.selection
        })"
        >
        Find your school
      </button>
    </div>



    `;
  }

  ampBeforeRender(ampBody$, urlObj) {
    if (!this.enabled) return;
    ampBody$
      .find("#findMyCollegePlaceholder")
      .replaceWith(this.collegeSelector);

    ampBody$
      .closest("html")
      .find("style[amp-custom]")
      .each((i, ampCustomStyle) => {
        ampCustomStyle.innerHTML += this.ampFindMyCollegeCss;
      });
  }
}

/**
 * Prefetch amp documents.
 */
class Prefetch {
  constructor(pwa) {
    this.pwa = pwa;
    this.prefetchSession = pwa.session.prefetch;
  }

  /**
   * Returns whether it is appropriate to prefetch the AMP document.
   * This gets called often, so it is more performant to make decisions
   * about prefetching in the AMP build stage when adding the
   * data-prefetch="1" property to link tags.
   *
   * @param {String} ampPathname - normalized (no query params) pathname of amp document
   * @returns {boolean}
   */
  prefetchCheck(ampPathname) {
    // Don't prefetch unnecessarily
    if (
      this.pwa.session.isPreview ||
      this.pwa.session.isPreprod ||
      this.pwa.session.isNoFetch ||
      !this.prefetchSession.prefetchesAvailable ||
      this.prefetchSession.prefetched[ampPathname] ||
      ampPathname == location.pathname
    )
      return false;

    return true;
  }

  /**
   * Prefetches an amp document if link is currently in viewport.
   *
   * @param {HTMLAnchorElement} link - the anchor tag with the amp document href
   * @param {URL} ampUrlObj - the url of the amp document to fetch
   * @returns {Promise} - resolves or rejects on fetch success
   */
  async prefetchHandler(link, ampUrlObj) {
    /* ensure that the link has entered the viewport,
      but not exited before this.prefetch.prefetchDelay.
      link.wmIsIntersecting is set by this.intersectHandlerDelay */

    if (!link.hasAttribute("data-intersecting")) return;
    if (!this.prefetchCheck(ampUrlObj.pathname)) return;

    // fetch
    try {
      this.prefetchSession.prefetchesAvailable -= 1;
      this.prefetchSession.prefetched[ampUrlObj.pathname] = 1;
      ampUrlObj.searchParams.delete("skuId");
      await fetch(ampUrlObj.href);
      this.prefetchSession.prefetchesAvailable += 1;
      // if (this.pwa.session.isStaging)
      //   console.log("prefetch amp: " + ampUrlObj.pathname);
    } catch (err) {
      this.prefetchSession.prefetchesAvailable += 1;
      // console.log("Failed to add amp document to cache: ", err);
    }

    this.pwa.intersectHandlerUnregister("wmPrefetch", link);
  }

  /**
   * Sets .wmIsIntersecting property (if element is currently in viewport) on entry.target
   * If entry is intersecting, handle the intersection after this.prefetch.prefetchDelay.
   * This prevents prefetching while users are scrolling.
   *
   * @param {IntersectionObserverEntry} entry - entry to evaluate
   * @returns {undefined} - sets timeout to handle intersection if appropriate
   */
  prefetchHandlerDelay(pwa, entry) {
    /* note: 'this' is bound to null in this callback */
    const prefetch = pwa.prefetch;
    const link = entry.target;

    /* Flag whether the link is 100% visible.
      For an intersection observer with visibility threshold: [0, 1]
      when a link enters and then exits the viewport
      the intersection observer fires 3 times:
      0: when link enters the viewport, when link exits viewport
      1: when link is 100% visible
    */
    // const wmIntersecting = entry.intersectionRatio === 1 ? true : false;
    if (entry.isIntersecting) link.setAttribute("data-intersecting", true);
    // do not fetch non-intersecting links (links entering and exiting)
    else return link.removeAttribute("data-intersecting");

    // normalize tracked URLs to only amp-origin document pathnames
    const linkUrl = new URL(link.href);
    const ampHref = pwa.amp.ampUrl(linkUrl);
    const ampUrlObj = pwa.util.urlObjGet(ampHref);
    const shouldPrefetch = prefetch.prefetchCheck(
      ampUrlObj.pathname,
      linkUrl.pathname
    );
    if (!shouldPrefetch) return;

    setTimeout(() => {
      requestIdleCallback(
        prefetch.prefetchHandler.bind(prefetch, link, ampUrlObj)
      );
    }, prefetch.prefetchSession.prefetchDelay);
  }
}

/**
 * Document Loader (for a Progressive Web App)
 *   Can load multiple AMP + Canonical documents at the same time
 *   for smooth transitions and infinite plp scrolling
 *
 * Responsibilities (in approximate order of Execution):
 *
 *    Session Configuration
 *      constructor() - defines session object
 *      sessionInit() - modifies session object
 *
 *    Loading Documents
 *      load() - loads a document in the appropriate document host
 *      loadTypeGet() - determines what kind of document is being loaded
 *        // loadTypeMatch() - compares urlObject against loadTypeTests rules
 *      loadDocGet() - determines which host to load a document in
 *      noLoad() - Load the canonical site without PWA
 *      loadErrorHandler - primary error handler handles exceptions thrown in load() or sub-functions
 *
 *    Browser Navigation
 *      historyClickHandler() - intercepts navigation click event in documents, loads a document
 *      historyGetHrefIfAnchor() - returns the href if an anchor was clicked
 *      historyPopStateHandler() - intercepts back or forward button press, loads a document
 *      historyPush() - updates URL if appropriate
 *
 *    Error handling
 *      errorCustom() - create custom errors with data
 *
 */
class Pwa {
  constructor(win, pwaSessionInit) {
    /*
        A single state tree to store routing configuration
        and user-specific data during the PWA session.

        Intially serves configuration purposes,
        then serves session purposes as it is modified and overwritten.

        Store all routing information here as a single source of truth.
    */
    this.session = {
      /* IDs of amp-states to keep in session/local storage.
        These states are persisted from amp page to amp page.
        User modifications are remembered
       */
      amp_sessionStorageIds: ["changeStore", "storeInfo"],
      amp_sessionStorage: {},
      amp_localStorageIds: [],
      amp_localStorage: {},
      /*
        These are the various documents in the pwa
        These objects reference the host for the document
        and some document components.
      */
      docs: {
        primary: {
          docnum: "1",
          hostElem: document.querySelector("#wmHostPrimary"),
          shadowDoc: null,
          shadowBody: null,
          href: null,
        },
        pdp: {
          docnum: "2",
          hostElem: document.querySelector("#wmHostPdp"),
          shadowDoc: null,
          shadowBody: null,
          href: null,
        },
      },

      /* Object to store history state for each url. Uses:
        - storing document.referrer for now (for use in this.historyPopStateHandler).
        - store document ampState in future?
      */
      history: {},

      /* Test to see if incoming requests is an interaction layer
       request from a Google Search Results amp page */
      isInteractionReg: /^(?!a)a/i,

      isFast: /wmFast/i.test(location.search),

      /* 0 while first document is loaded. */
      pageLoad: 0,

      prefetch: {
        /* object to track prefetched pathnames */
        prefetched: {},

        /*
          To ensure we prefetch the most relevant AMP documents
          without overloading CDNs and browser caches,
          wait this amount of time after intersection,
          then check if the amp document
          anchor tag is still in the viewport before
          prefetching an amp document
        */
        prefetchDelay: 300,

        /* maximum number of concurrent amp documents to prefetch */
        prefetchesAvailable: 5,
      },

      /* Backup title for History.pushState API */
      titleDefault: "",

      /* determines if we are in production or preprod */
      // JW - TODO - Defined in ExtraWompLib now - remove after 6.16.21
      // isPreprod: /(bbbyapp|bbbabyapp|bbbycaapp).com/i.test(location.origin),

      /*
        We were seeing issue on the following PDP page where sitespect was injecting scripts and
        moving appshell css into amp document
        https://em02-www.bbbyapp.com/store/product/nespresso-by-breville-vertuoline-coffee-and-espresso-maker-bundle-with-aeroccino-frother/3316521?strategy=recentlyViewed
        In e-mail thread (subject: Sitespect test in em02?)
        SiteSpect asked us to disable in em02 until they could figure out the issue.

        Normal code should be below:
        runSiteSpect: !/wmFast/gi.test(location.search)
      */
      runSiteSpect: true,
      isBABY: /baby/i.test(location.hostname) ? true : false,
      isCANADA: /ca/i.test(location.hostname) ? true : false,
      isHARMON: /harmonfacevalues/i.test(location.hostname) ? true : false,
      isBBB_US: /www\.bedbathandbeyond\.com|bbbyapp/i.test(location.hostname)
        ? true
        : false,
    };

    // modify initial this.session above with appshell routing overrides
    this.sessionInit(pwaSessionInit);

    /* Creating Regular expressions once is more performant
              than creating them on the fly every time.
              this object is for generic hash functions that can be
              reused across sites.
              Site-specific regex should go in this.session */
    this.regExp = {
      hash: /#.*/i,
      scrollTo: /(\w+).scrollTo/i,
      tmAndReg: /-(trade|tm|reg)-/gi,
    };

    // polyfill requestIdleCallback for iOS
    // https://developers.google.com/web/updates/2015/08/using-requestidlecallback
    win.requestIdleCallback =
      win.requestIdleCallback ||
      function (cb) {
        var start = Date.now();
        return setTimeout(function () {
          cb({
            didTimeout: false,
            timeRemaining: function () {
              return Math.max(0, 50 - (Date.now() - start));
            },
          });
        }, 1);
      };

    /**
     * Returns the outerHTML of a list of elements as a text string
     * @context {CashJsCollection} this - a cashJs object
     * @returns {String} - a string containing the outerHTML of the elements

      Warning: because this returns a string instead of a cashJs object,
                chaining this will result in an unhandled error.

      ex: let template = `
        <div class="everyLinkOnThePage">
            {$('a').outerHTML()}
        </div>`;
    */
    $.fn.extend({
      outerHTML: function () {
        return this.get()
          .map((e) => e.outerHTML)
          .join("\n");
      },
    });

    // Pwa orchestrates these subclasses, which have narrower scopes
    // We don't have import statements, so this is the next best thing.
    // Each subclass can refer to this class at subclassInstance.pwa
    // note: Allow for use of util functions in other class initiators
    this.util = new Util(this);
    // Convenience DOM and Template selector
    this.$$$ = this.util.querySelectorAllDomAndTemplate;

    this.amp = new Amp(this);
    this.appshell = new Appshell(this);
    this.analytics = new Analytics(this);
    this.college = new College(this);
    this.desktop = new Desktop(this);
    this.ideaboard = new Ideaboard(this);
    this.imgZoom = new ImgZoom(this);
    this.pdpStickyNav = new PDPStickyNav(this);
    this.mo = new Mo(this);
    this.navPanel = new NavPanel(this);
    this.paginatedSlider = new PaginatedSlider(this);
    this.personalize = new Personalize(this);
    this.plp = new Plp(this);
    // this.plpLeftTest = new PlpLeftTest(this);
    this.pdp = new Pdp(this);
    this.pencilBanner = new PencilBanner(this);
    this.findMyCollege = new FindMyCollege(this);
    this.prefetch = new Prefetch(this);
    this.sayt = new Sayt(this);

    this.pickItModal = new PickItModal(this);
    this.deliveryModal = new DeliveryModal(this);

    /*
      This is not yet used for main cart call
      Only quantity update cart call
    */
    this.cart = new Cart(this);

    // note: this.site depends on Class instances above for interactionParamRouter
    this.site = new Site(this);
    this.user = new User(this);

    // note: Registry depends on this.user, has limited functionality if user does not have isActiveRegistrant cookie,
    if (this.session.features.registryEnable)
      this.registry = new Registry(this);

    this.quickView = new Quickview(this);
    this.pwa = this;

    // Register handler for back and forward button navigation
    this.win = win;

    /*
    Handle back and forward button presses.
    setTimeout() is so that window and document objects
    are in sync when this.historyPopStateHandler is called.
    https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event */
    this.win.addEventListener("popstate", (event) => {
      setTimeout(this.historyPopStateHandler.bind(this, event), 0);
    });

    /* Throttled scroll event handler */
    if (this.pwa.util.isDesktop()) {
      for (const doc of Object.values(this.session.docs)) {
        this.util.scrollEvtThrottle(
          this.headerScrollFn,
          doc.hostElem.parentNode,
          100
        );
      }
    }
  }

  /**
   * Intercepts blur events on amp document body.
   * This is registered in ampPostRender with the "useCapture=true" parameter
   * to intercept blur events on the body during the capture phase.
   *
   * https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
   *
   * If you need to stop the default AMP behavior for any reason,
   * you can use this.util.stopEvent(event) to stop
   * peer-level event handlers registered by the AMP framework.
   *
   * @param {Object} docObj - document object whose document.body was clicked
   * @param {MouseEvent} event - click event
   */
  async blurBodyHandler(docObj, event) {
    const target = event.target;
    // PLP filters "search" input blur
    if (target.id === "filtersSearchInput")
      this.session.pendingProdListHistoryUpdate = true;

    if ($(target).is(".setQtyInputJs")) {
      try {
        let skuObj = {};
        const collectionQty = $(target).hasClass("collectionQtyDD");
        if (collectionQty) {
          let qty = Math.abs(parseInt(event.target.value));
          qty = !qty ? 0 : qty;
          const prodId = $(target)
            .parent()
            .find(".scrollTarget")
            .attr("id")
            .replace("qtyListTarget", "");
          skuObj[`skuFacets${prodId}`] = {
            qty10plus: qty >= 10 ? true : false,
            qty: qty,
          };
        } else {
          let skuFacets = await this.pwa.pdpDataAbstraction.getPDPState(
            "skuFacets"
          );
          let qty = Math.abs(parseInt(skuFacets.qty));
          qty = !qty ? 1 : qty;
          if (qty < 10) {
            skuObj[
              `skuFacets${this.pwa.site.prodIdGet(
                new URL(this.pwa.session.docs.pdp.href)
              )}`
            ] = { qty10plus: false, qty: qty };
          }
        }
        this.pwa.amp.ampsSetState(skuObj);
      } catch (e) {
        console.warn(`Unable to parse qauntity from skuFacets`);
      }
    }
  }

  /**
   * Decorates ampBody with class to show or hide header
   * remembers last scroll position when stopped.
   * @param {ScrollEvent} evt - document container scroll event;
   */
  headerScrollFn(evt) {
    const currentScrollPosition = window.scrollY;
    if (currentScrollPosition == this.session.docObjActive.lastScrollPosition)
      return;

    if (
      currentScrollPosition > 100 &&
      currentScrollPosition > this.session.docObjActive.lastScrollPosition
    ) {
      $(this.session.docObjActive.shadowBody).addClass("miniHeader");
    } else {
      $(this.session.docObjActive.shadowBody).removeClass("miniHeader");
    }
    this.session.docObjActive.lastScrollPosition = currentScrollPosition;
  }

  /**
   * Determines if user clicked on an anchor
   * If so, return the href of the anchor.
   *
   * @param {MouseEvent} event - click Event
   *    This is usually called from a click handler
   *    attached to the body of a document,
   *    so the event has bubbled up.
   * @returns {String|null} - href of link | null if not found
   */
  clickAncestorHref(event) {
    // Is it a link?
    let a = event.target;
    while (a) {
      if (a.tagName == "A" && a.href) {
        break;
      }
      a = a.parentElement;
    }
    if (!a || !a.href) return null;

    // Should it open in this context?
    let target = a.getAttribute("target") || "_self";
    let otherTarget = !/_(self|top|parent)/i.test(target);
    let download = a.hasAttribute("download");
    if (otherTarget || download) return null;

    // We should return href to load in PWA
    return a.href;
  }

  /**
   * Intercepts anchor clicks.
   * If href is found, loads href in the PWA.
   *
   * @param {Object} docObj - document object whose document.body was clicked
   * @param {MouseEvent} event - click event
   *    if preventDefaultAmpHandlers is set to true,
   *    calls event.preventDefault() & event.stopPropagation() to prevent AMP handlers
   * @returns {Boolean} - whether to propagate click event
   */
  async clickBodyHandler(docObj, event) {
    let target$ = $(event.target);

    if (target$.is(".wmHost")) return;

    if (this.pwa.session.isDebug) console.trace("Click Event", docObj, event);

    /* This handler is registered on the body element before
      the AMP framework has a chance to register click handlers.
      If event.preventDefault was called by a child element
      click handler before bubbling up to ampBody, don't handle the event. */
    if (event.defaultPrevented) return false;

    /* If preventDefaultAmpHandlers == true:
      - then (peer) AMP framework click handlers like amp-analytics
        "linker" will not change <a> href and navigate programmatically.
      - pwa will not navigate programatically.
    */
    let preventDefaultAmpHandlers = false;

    /* Tealium click event reporting */
    this.site.tealiumClickEventEmitter(event.target.cloneNode(false));

    // function scrollbarGutter(el) {
    //   const scrollTop = document.documentElement.scrollTop;
    //   let appshellCss = $("head").find("style[data-wm]");
    //   appshellCss.text(
    //     `.PWAMP.modalOpen {
    //       overflow-y: scroll;
    //       position: fixed;
    //       top: -${scrollTop}px;
    //     }` + appshellCss.text()
    //   );
    //   $(el)
    //     .parent()
    //     .append(
    //       `<style>.PWAMP.modalOpen #wm_content{position:relative;top:-${scrollTop}px;}</style>`
    //     );
    // }
    /* fix appshell body to prevent scroll when modals are open */

    // close footer panel if it exists since it exists outside of the ampBody
    const registryFooterPanel = $(".registryFooterPanel");
    if (
      this.pwa.session.features.registryEnable &&
      registryFooterPanel.length &&
      !target$.is("[data-registry-footer]") &&
      !target$.closest(".registryFooterPanel").length &&
      !target$.closest("[data-registry-footer]").length
    ) {
      this.pwa.registry.closeRegistryFooterPanel();
    }

    if (
      this.pwa.session.features.registryEnable &&
      this.pwa.user.hasRegistry &&
      this.pwa.registry.renderCtaMenuFlag
    ) {
      delete this.pwa.registry.renderCtaMenuFlag;
    }

    this.pwa.util.scrollToggle(docObj, target$);

    /* pdpv21 and pdpv2 refactored click handlers */
    if (target$.is(".klarnaInfoIcon,.afterPayInfoIcon")) {
      preventDefaultAmpHandlers = true;
      this.pwa.site.paymentOptionClick(target$);
    }

    if (target$.is("#payToggle"))
      this.pwa.site.activatePaymentOptions(target$.closest("body"));

    /* Use current location in the Change store modal header & PDP */
    if (target$.is(".clGps")) {
      this.pwa.site.getCurrLocation(target$, "bopis");
    }

    // PLP current location for sdd zip modal
    if (target$.is(".useGpsForZipJs"))
      this.pwa.site.getCurrLocation(target$, "sdd");

    /* Check for click handler attribute
      ex: <button data-click-handler="user.logout">Log out</button> */
    const clickHandler = target$.attr("data-click-handler");
    if (clickHandler)
      this.dataEventHandlerParseAndCall(clickHandler, target$, event);

    // give desktop users time to move cursor from nav category bar to nav panel
    if (this.pwa.navPanel.navDskCategoryBtnClickDebounce(target$)) return;

    // PDP - Intercept navigation for write a review link - open modal instead.
    // Check for write a review link
    let targetHref = $(event.target).attr("href");
    try {
      // checking parameters for write a review modal or ask a question
      const ctaParams = this.pwa.session.ctaParams;
      for (let i = 0; i < ctaParams.length; i += 1) {
        let item = ctaParams[i];
        const tmpReg = new RegExp(item, "gi");
        if (tmpReg.test(targetHref)) {
          const urlObj = new URL(targetHref);
          this.pwa.site.scrapeProdData($(docObj.shadowBody), urlObj, item);
          preventDefaultAmpHandlers = true;
        }
      }
    } catch (e) {
      console.warn(
        `Unable to get CTA parameters from pwa session or error matching parameters to url. Error ${e}`
      );
    }

    // check for layout shift clicks and reposition absolute elements
    if (target$.is("[data-cls],.btnSize,.swatchTap")) {
      this.pwa.site.socialAnnexHide();
      setTimeout(this.pwa.site.socialAnnexPosition.bind(this), 600);
    }

    //Desktop only events
    if (window.innerWidth >= 768) {
      this.pwa.site.dskCloseOnClick(event);
      if ($(event.target).hasClass("filterModal"))
        this.pwa.amp.ampsSetState({ plpModals: { dskFilter: false } });

      // PLP facet click handler
      this.pwa.desktop.plpFacetClick($(event.target), docObj.shadowBody);

      // close modals when mask clicked
      if (
        target$.is(`
        .modal.active,
        .modalImg.active,
        .modalActive.filtersReviewsCont
      `)
      ) {
        this.pwa.amp.ampsSetState({
          u: {
            modalDynamic: null,
            modalImg: null,
            modalZip: null,
            reviewsExpanded: null,
            storePickupModal: null,
            qa: null,
            vendorModal: false,
            cartError: false,
          },
        });
        $("body").removeClass("modalOpen");
      }
    }

    // View full product details button click
    if (target$.is(".fullProdDet")) {
      this.pwa.quickView.quickViewClose(event);
    }

    // Check to see if click is on the desktop menu. Set the inital state of the menu
    let dataClk = $(event.target).attr("data-dsk-click");
    if (typeof dataClk == "string" && dataClk.toLowerCase() == "categories")
      this.pwa.desktop.initDskMenu(target$.closest("body"));

    // Persistent state-changing variables
    // ex: Remember when user selects store pickup, same day delivery, navigation options.
    if (
      target$.is(
        `#prodBopisCbPwa, [data-click="changeStore"], .nav1Btn, .navBack, .navItem`
      )
    )
      setTimeout(this.amp.ampStoreAmpStates.bind(this.amp), 200);

    // Setup customized form validation for oos form
    if (target$.hasClass("oosFormCancel")) {
      event.preventDefault();
      // setup email binding since amp-bind no longer works in forms
      target$.closest("body").removeClass("modalOpen");
      this.pwa.amp.ampsSetState({ u: { outOfStockModal: false } });
    }
    // Search - clear recent Searches
    if (target$.is(".linkClearRecent")) this.site.recentSearchClear();

    //Slider click
    if (target$.is(".sliderControl")) {
      this.pwa.paginatedSlider.sliderClick(event);
      return;
    }

    // PWA navigation check
    let href = this.clickAncestorHref(event);

    // Sponsored Products and BannerX click handler reporting
    if (href) {
      let plpProdCard = target$.closest(
        ".prodCardWrap, .adCard.overflowHidden"
      );
      if (plpProdCard.attr("data-cta"))
        this.site.tealiumClickEventEmitter(plpProdCard.clone()[0]);
    }

    // /*
    //   New Sticky Nav
    //   This was introduced as part of the collections overview redesign (PP-369)
    //   This will eventually replace on all pages and the above can be removed
    // */
    if (target$.is(".pdpTabLink2")) {
      /* Just in case the intersection doesn't exactly line up, we will still the corret nav item selected
      Sometimes if the scroll target gets misaligned or the pencils banner is still visible, the section
      may not cross the intersection and the correct nav item is not displayed.
      This really only happens on click. So we wait 700 ms and check to make sure the correct item is displayed */
      setTimeout(async (e) => {
        target$.closest("body").find(".underline").attr("style", "");
        target$.closest("li").find(".underline").attr("style", "opacity: 1;");
      }, 950);
    }

    /*
      Close the quantity selector when user clicks elsewhere

      Tried using a native modal mask that was transparent
      That worked, except the next click after quantity was open appeared to not do anything
      So if the user clicke ATC button while quantity was open, it would close the quantity but not add to cart.
      Also tried to use blur body handler but since we want user to be able to tab to the quantity options
      I realized that also will not work.
      This was the last resort option.
    */
    if (
      this.pwa.session.docTests.isPDPReg.test(location.pathname) &&
      $(docObj.shadowBody).find(".qtyOptionList").hasClass("active") &&
      !target$.is(".qtyOpt") &&
      !target$.is(".qtySelectBtn")
    ) {
      let skuObj = {};
      //qtyBtns5566653
      $(docObj.shadowBody)
        .find(".qtyOptionList.active")
        .each((i, e) => {
          try {
            let idPrefix = $(e).hasClass("ffOptionList")
              ? "ffListTargetList"
              : "qtyList";
            let prodId = $(e).attr("id");
            prodId = prodId.replace("qtyBtns", "").replace("ffilmentBtns", "");
            if (!prodId || `${idPrefix}${prodId}` == target$.attr("id")) return;
            skuObj[`skuFacets${prodId}`] = {
              qtyExpanded: false,
              fullFillExpanded: false,
            };
            this.pwa.amp.ampsSetState(skuObj);
          } catch (e) {
            console.warn(
              `clickbody handler, error closing quantity. Error: ${e}`
            );
          }
        });
    }

    /* Remove quick view param from plp clicks
       This was requested due to analytics issue.
       This should be removed when quickview is implemented again */
    // if (target$.is(".plpAtc") && /quickView=true/.test(href)) {
    //   var urlObj = new URL(href);
    //   urlObj.searchParams.delete("quickView");
    //   href = urlObj.toString();
    //   target$.attr("href", href);
    // }

    // check if the click is a control/command click and open in new tab
    if ((event.ctrlKey && href) || (event.metaKey && href)) {
      preventDefaultAmpHandlers = true;
      window.open(href, "_blank");
    }

    if (docObj && href && !preventDefaultAmpHandlers) {
      let unused = undefined,
        isHandled = undefined;
      if (!target$.is(`[data-no-click-interaction]`))
        /* Check for Add to Ideaboard, other interactionParam handlers */
        [unused, isHandled] = await this.site.interactionParamRouter(
          this.util.urlObjGet(href)
        );

      /* break out of program flow. Load page on next script cycle. */
      if (!isHandled)
        setTimeout(
          function (href, docObj) {
            this.load(href, docObj);
          }.bind(this, href, docObj)
        );

      preventDefaultAmpHandlers = true;
    }

    /* Depending on your use case, you may want to consider enabling amp-analytics click events
      and linker params events for non-Pwa links. Refer to Providence Analytics for an example.
      If we don't stopEvent here, then the amp framework will handle events,
      linker params, and navigate for <a> clicks. */
    if (preventDefaultAmpHandlers) {
      this.util.stopEvent(event);
      return;
    }

    /* Non-Nav click events here */
    /* Note: Form Submissions are handled by this.formSubmitHandler */

    /* Set flag to Update URL with new product list params after
        amp-bind completes cycle and product list state is current
        set to pendingProdListHistoryUpdate to true if they click on a facetPill or element in .plpOptsSub (filter accordion)
    */
    if (/prodBopisCb|plpCb|plpPill|sort|plpPage/i.test(target$.attr("class")))
      this.session.pendingProdListHistoryUpdate = true;
  }

  /**
   * Error constructor for expected errors.
   * If on staging site, log and view error details.
   *
   * Errors created with this constructor
   * are logged here for clearer Promise stack tracing.
   *
   * @param {String} message - Error Message
   * @param {Any} data - Data to attach to error
   * @returns {Error} - Error message with optional data object
   */
  errorCustom(message, data) {
    // return new ErrorCustom(message, data);
    let error = new Error(message);
    error.data = data || {};

    if (this.session.isStaging) {
      let errorObj = {
        data: data,
        date: Date.now(),
        message: message,
        stack: error.stack,
      };

      // help debug navigation errors
      try {
        sessionStorage.setItem("pwaExpectedError", JSON.stringify(errorObj));
      } catch (e) {}
      console.log(errorObj);
      if (this.session.isDebug && message !== "ampPageNotBuilt") debugger;
      // throw error
    }

    return error;
  }

  /**
   * Initialize data-x-handlers found on individual Element Attributes
   *  ex: data-change-handler="plpLeftTest.filterBrands()", TODO: data-focus-handler, data-blur-handler
   *  note: data-click-handler currently is handled more efficiently in bodyClickHandler.
   *  We need to be careful to place event handlers at the appropriate DOM level
   *  to limit them to a reasonable number of callbacks
   * @param {CashJsCollection} ampElem$ ampBody$ (ampPostRender) or ampList$ (ampListPostRender)
   */
  dataEventHandlerRegister(ampElem$) {
    // input change handler
    // TODO - throttle event handler if CashJs doesn't do so already
    ampElem$.find("[data-change-handler]").each((i, e) => {
      let input$ = $(e);
      let handlerExpression = input$.attr("data-change-handler");
      input$.on(
        "propertychange input",
        this.pwa.dataEventHandlerParseAndCall.bind(
          this,
          handlerExpression,
          null
        )
      );
    });
    // TODO?: data-focus-handler, data-blur-handler
  }

  /**
   * Parses and calls all functions passed in handlerExpression as comma separated calls
   * to use comma separated call, pattern must include ")," ex class.function(), class.function2()
   * Used by data-click-handler, data-change-handler (inputs), TODO - data-blur-handler
   * @param {String} handlerExpression - pwa class.function() - ex "plpLeftTest.filterBrands()"
   * @param {CashJSCollection} (opt) target$ - the target element
   * @param {Event} evt - browser event
   * @returns undefined
   */
  async dataEventHandlerParseAndCall(handlerExpression, target$, evt) {
    if (!handlerExpression) return;

    // account for poorly formatted comma seperated expressions
    handlerExpression = handlerExpression.replace(") ,", "),");

    // if the expression contains a comma following the function call, call for each function
    if (/\),/.test(handlerExpression)) {
      const regex = RegExp("(.*?\\)),", "g");
      let match;
      // handles all expressions that have a trailing comma
      while ((match = regex.exec(handlerExpression)) !== null) {
        await this.dataEventHandleSingleCall(match[1].trim(), target$, evt);
      }
      // handles final expression passed
      let lastExp = handlerExpression.slice(
        handlerExpression.lastIndexOf("),") + 2
      );
      await this.dataEventHandleSingleCall(lastExp.trim(), target$, evt);
    } else {
      // if the expression doesnt have multiple expressions handle the one call
      await this.dataEventHandleSingleCall(handlerExpression, target$, evt);
    }
  }

  /**
   * Parses and calls a pwa function from a handler string.
   * @param {String} handlerExpression - pwa class.function() - ex "plpLeftTest.filterBrands()"
   * @param {CashJSCollection} (opt) target$ - the target element
   * @param {Event} evt - browser event
   * @returns undefined
   */
  async dataEventHandleSingleCall(handlerExpression, target$, evt) {
    let [pwaClass, ...pwaClassMethod] = handlerExpression.split(".");
    // If args in method have periods, they will be split too and need to be joined back together
    pwaClassMethod = pwaClassMethod.join(".");
    let argsMatch = /\((.*)\)/i.exec(pwaClassMethod || "");
    let argsString = "";
    if (argsMatch) {
      pwaClassMethod = pwaClassMethod.replace(argsMatch[0], "");
      argsString = argsMatch[1];
    }
    if (pwaClass && pwaClassMethod) {
      try {
        // each handler will need to parse and validate the argsString in it's preferred manner
        return await this.pwa[pwaClass][pwaClassMethod](
          argsString,
          target$,
          evt
        );
      } catch (e) {
        console.log(
          `Error calling this.pwa[${pwaClass}][${pwaClassMethod}]`,
          e
        );
      }
    }
  }

  /**
   * Handle form submissions from AMP (and optionally MO) pages.
   * @param {SubmitEvent} event - form submission event
   *    consider calling this.util.stopEvent() to prevent AMP handlers
   *    if AMP form handlers are still handling forms when you don't want
   *    them to, remove, clone, and reattach the form before
   *    ths.formSubmitHandlerRegistration is called in ampPostRender or ampListPostRender.
   *    That will assure that this handler is the first one attached to the form.
   * @returns {Boolean} - whether to propagate submit event
   */
  formSubmitHandler(event) {
    try {
      let form = $(event.target);
      let handled = this.site.formSubmitRouter(form);
      if (handled) this.util.stopEvent(event);
    } catch (ex) {
      console.log(ex);
    }
  }

  /**
   * Register formSubmitHandler on form.
   *
   * This function exists so this.formSubmitHandler can
   * registered from a variety of functions:
   *    amp.ampPostRender
   *    "pwaDomAdded" event handlers
   *    consider mo.moPostRender
   *
   * @param {Number} i - index of form (unused)
   * @param {HTMLFormElement} form - Form
   */
  formSubmitHandlerRegistration(i, form) {
    form.addEventListener("submit", this.formSubmitHandler.bind(this), true);
  }

  /**
   * Loads appropriate document when:
   *    - back or forward button is pressed
   *    - history.back() is called in js
   *
   * @param {PopStateEvent} event
   * @returns {undefined}
   *    this.session.popStateInProgress flag is set to true.
   *    popStateInProgress lets historyPush() know that
   *    the URL has already been changed.
   */
  historyPopStateHandler(event) {
    const newPathSearch = `${location.pathname}${location.search}`;

    /* Test if iOS has called historyPopState without actually navigating.
    JW 10.28.20 - not sure if this is necessary now that
    this function is called in a setTimeout() in order to sync
    window and document states. Leaving it to be sure. */
    const currUrl = new URL(this.session.docObjActive.href);
    if (newPathSearch == `${currUrl.pathname}${currUrl.search}`) return;

    // Update document.referrer for analytics packages
    this.session.history = this.session.history || {};
    let state = this.session.history[location.href] || {};
    if (state.referrer) this.util.referrerSet(state.referrer);

    this.session.popStateInProgress = true;
    this.load(location.href);
  }

  /**
   * Updates URL and document.referrer if appropriate
   *
   * @param {Object} docObj - object with document and document host references
   * @returns undefined - Updates URL in address bar.
   */
  historyPush(docObj) {
    // Do not update history when PDP host is opened as a ?quickView Modal.
    let url = new URL(docObj.href || location.href);
    if (url.searchParams.has("quickView")) return;

    /* Navigation was caused by back or forward button, so
      History and document.referrer have already been updated */
    if (this.session.popStateInProgress) {
      this.session.popStateInProgress = false;
    } else {
      /* Navigation caused by <a> click or <form> submission inside document.
        1. History has not yet been updated and
        2. the page has loaded successfully in docObj.
        ..so..
        3. Show new URL and
        4. update session history and document.referrer.
      */
      let state = this.session.history[docObj.href] || {};

      state.referrer =
        this.session.pageLoad == 1 ? document.referrer : window.location.href;
      this.session.history[docObj.href] = state;

      // If pageLoad 2 or higher manage history and referrer state in SPA soft nav
      // Browser will manage referrer and history for initial page load
      if (this.session.pageLoad == 1 && !this.pwa.session.redirectInProgress)
        return;
      this.pwa.session.redirectInProgress = false;
      this.util.referrerSet(state.referrer);
      this.win.history.pushState(
        state,
        docObj.shadowDoc.title || this.session.titleDefault,
        docObj.href
      );
    }
  }

  /**
   * @description Creates an intersection observer for anchor tags in the provided element
   *
   * this.intersectionHandlerDelay(entry) callback is fired when the anchor tag:
   *  enters the parent element
   *  becomes 100% visible
   *  leaves the parent element
   *
   * @param {String} ioName - name of intersection observer to reuse between ampPostRender and ampListPostRender
   * @param {Element} element - element to monitor for anchor tag viewport intersection.
   *    element should have a[data-prefetch] anchor tags inside it.
   * @param {String} selector - selector for child elemens to observe
   * @param {Function} fn = callback function.
   * @param {Object} opt - optional default overrides for rootMargin and threshold
   */
  intersectHandlersRegister(ioName, element, selector, fn, opt) {
    let options = {
      rootMargin: "0px 50% 100% 50%",
      threshold: [0, 1],
    };
    if (opt) Object.assign(options, opt);
    if (!fn || !element || !selector)
      return console.error(
        this.errorCustom("Intersection observer missing required elements", {
          element: element.outerHTML,
          selector: selector,
          fn: fn,
        })
      );
    // reuse "ioName" intersection observer on closest amp body
    let io;
    const body = element.closest("body");

    if (body[ioName]) io = body[ioName];
    else
      io = body[ioName] = new IntersectionObserver(
        (entries) => {
          entries.forEach(fn.bind(null, this));
        },
        {
          root: null,
          rootMargin: options.rootMargin,
          threshold: options.threshold,
        }
      );
    //  /* registered on amp host element, which needs to be scrollable.
    //    You can register on document, ampBody, or other element as needed.
    //  */
    //  root: element.getRootNode().host.parentElement,

    // observe children inside element.
    $(element)
      .find(selector)
      .each((i, link) => {
        try {
          io.observe(link);
        } catch (err) {
          this.errorCustom("IntersectionObserver failed to run on anchor", {
            anchor: link,
            err: err,
          });
        }
      });
  }

  /**
   * unregister element from intersection observer
   * body.wompIo reference created in pwa.intersectHandlersRegister
   * to reuse a single IntersectionObserver for all elements
   * @param {String} ioName - name of Intersection observer
   * @param {Element} elem - element to no longer register
   */
  intersectHandlerUnregister(ioName, elem) {
    const body = elem.closest("body");
    if (!body) return;

    const io = body[ioName];
    if (io) io.unobserve(elem);
  }

  /**
   * Loads the document in the appropriate document host:
   *
   *   1. Determine the type of document
   *   2. Handle invalid links
   *   3. Loading overlay
   *   4. Load the document in the appropriate host
   *        uses amp.ampLoad and mo.moLoad to handle loading details.
   *   5. Loading Overlay, set appropriate host classes
   *   6. Update history state if no errors thrown
   *   7. (opt) After initial load, progressively enhance appshell/pwa
   *
   *  Assumes that appshell has fallen back to canonical for browsers without 'ShadowRoot'
   *  Assumes that appshell has already polyfilled JS features:
   *     'Promises', 'fetch', 'IntersectionObserver',
   *     Cash.js (optional jQuery style $ method chaining)
   *
   * @param {String} href - Relative or absolute path
   *    Many of the method calls in this function reference
   *    this.session.docObjActive to determine their results.
   * @returns {Promise} - Promise that resolves when page load or error handling is finished
   */
  async load(href) {
    console.log(`version: ${this.session.appshellVersion}, loading: ${href}`);
    try {
      // 1. Determine the type of document
      let urlObj = this.util.urlObjGet(href);

      // 1.5 Handle interaction params from amp pages.
      let unused;
      [urlObj, unused] = await this.site.interactionParamRouter(urlObj);

      const hrefType = this.loadTypeGet(urlObj);

      // 2. Handle hrefs with non-standard loading behavior
      if (hrefType.constructor == Error) throw hrefType;
      else if (hrefType == "isNotPwa") return this.noLoad(urlObj.href);
      else if (hrefType == "isDiffDomain") return (window.location.href = href);
      else if (hrefType == "isAnchorHashCurrentPage")
        return this.util.scrollIntoView(
          this.session.docObjActive.shadowBody,
          urlObj.href
        );

      // 3. Loading overlay
      await this.appshell.appshellBeforeRender(this.session);

      // 4. Load the document in the appropriate host
      let docObjNext = this.loadDocGet(hrefType, urlObj);

      /* 4.1. Check if current document is amp and has:
        1. amp-state(s) that need to be stored in local or session storage or
        2. amp-bind & amp-bind-macro expressions that need to be persisted
           in AMP runtime when docObjNext is loaded */
      await this.amp.ampBeforeUnload(docObjNext);

      this.scrollPositionStore(
        this.session.popStateInProgress
          ? this.session.docObjActive.href
          : location.href
      );

      if (hrefType == "isAmp")
        docObjNext = await this.amp.ampLoad(docObjNext, urlObj);
      else if (hrefType == "isMo")
        return await this.mo.moLoad(docObjNext, urlObj);
      // docObjNext = await this.mo.moLoad(docObjNext, urlObj); // for iframe MO option
      else if (hrefType == "isLoadedInOtherDoc") {
        // this.amp.ampClearDoc(wmPwa.session.docObjActive);
        docObjNext = docObjNext;
        // docObjNext.shadowDoc.setVisibilityState("visible");
      }

      if (!this.pwa.quickView.quickViewLoaded)
        this.scrollPositionRestore(urlObj.href);

      // 5. Loading Overlay, set appropriate host classes based on docObjNext
      this.appshell.appshellPostRender(this.session, docObjNext);

      // 6. Anchor hash navigations
      // (multiple document containers don't play well with native window auto scroll)
      if (urlObj.hash)
        this.util.scrollIntoView(docObjNext.shadowBody, urlObj.hash);

      // 7. Update history state if no errors have been thrown at this point
      this.session.pageLoad += 1;
      this.session.redirectCount = 0;
      this.historyPush(docObjNext);
      this.session.docObjActive = docObjNext;

      // 7.5 Run ampPostRender if appropriate
      // JW 5.24.21 - move to pwa.load for more predictible URL
      // and amp-bind behavior in a multi-document environment.
      // This is necessary when transitioning from PLP to PDP.
      if (hrefType == "isAmp")
        this.amp.ampPostRender(this.session.docObjActive, urlObj);

      // 8. (opt) After initial load,
      // progressively enhance appshell/pwa once the AMP framework calms down
      if (this.session.pageLoad == 1)
        requestIdleCallback(
          this.site.loadFirstPagePostRender.bind(this.site, this)
        );
      else
        requestIdleCallback(
          this.site.scriptsEveryPagePostRender.bind(this.site)
        );

      return "Successfully loaded";
    } catch (err) {
      // 2. Handle invalid links
      // this.amp.ampLoad and this.mo.moLoad have the same requirements,
      // catch loading errors for both here.
      return this.loadErrorHandler(href, err);
    }
  }

  /**
   * Determines which host to load the document in.
   * Routing logic goes here for multiDocument PWAs.
   *
   * @param {String} hrefType - Type of document, 'amp' or 'mo'
   * @param {URL} urlObj - document url to evaluate
   * @param {Object} docObjActive (opt)
   *      - The document that the user is currently viewing,
   *        (this document is having a click handled)
   *        object with document and document host references.
   * @returns {Object}
   *      - A reference to a session.docs document object
   *      with appropriate host container.
   */
  loadDocGet(hrefType, urlObj) {
    if (hrefType == "isLoadedInOtherDoc") {
      for (const docObj of Object.values(this.session.docs)) {
        if (docObj.href == urlObj.href) return docObj;
      }
    } else if (hrefType == "isAmp") {
      if (this.session.docTests.isPDPReg.test(urlObj.pathname))
        return this.session.docs.pdp;
      else return this.session.docs.primary;
    } else if (hrefType == "isMo") {
      return this.session.docs.mo;
    }

    // backup document container logic: current or primary
    return this.session.docObjActive || this.session.docs.primary;
  }

  /**
   * Error handler for document loading errors.
   * If on staging site, view error details.
   *
   * @param {String} href - The URL that caused an error
   * @param {Error} err - Error Object
   * @param {Boolean} leavePwa - (true) whether to reload page without PWA.
   */
  loadErrorHandler(href, err, leavePwa = true) {
    delete this.session.ampAnalyticsIframeHtml;
    delete this.session.pendingSkuSelection;
    this.session.docPrefetch = null;
    if (err.message == "same url as current url") {
      // do nothing
    } else if (err.message == "wompRedirect") {
      this.session.redirectCount += 1;
      if (this.session.redirectCount > 3) {
        this.noLoad(err.data);
      } else {
        try {
          // Load redirected pages with marketing parameters
          // ex: https://www.bedbathandbeyond.com/store/brand/crux/8881?wmSkipPwa=1&S_HASH=2997c849789735c6432571e8b6a6ddb74034bace9cff9cdfa983b238b44208fb&mcid=EM_Productcampaign_202109_LDKitchenDining2_Offer&rid=13228533182&utm_medium=email&utm_source=Offer&utm_content=Productcampaign&utm_campaign=BBBY_US_20210904_337S_Labor_Day_Kitchen_Dining_Aplus&F_URL=https%3A%2F%2Fwww.bedbathandbeyond.com
          let currUrl = new URL(location.href);
          let redirectUrl = new URL(err.data);
          if (
            this.pwa.session.pageLoad == 0 &&
            redirectUrl.searchParams.has("wmSkipPwa") &&
            currUrl.pathname.includes(redirectUrl.pathname) &&
            (/(mcid|utm_)=/i.test(currUrl.search) ||
              currUrl.pathname.includes("/store/brand"))
          ) {
            redirectUrl = currUrl;
            redirectUrl.searchParams.set("wmSkipPwa", 1);
          }
          this.load(redirectUrl.href);
        } catch (e) {
          this.load(err.data);
        }
      }
    } else if (
      err.message == "ampPageNotBuilt" &&
      (this.session.isStaging || this.session.isDebug)
    ) {
      // wait for amp pages to build on staging site
      this.session.waitingForPageBuild = true;
      setTimeout(
        function (url) {
          this.load(url);
        }.bind(this, err.data.urlObj.href),
        1000
      );
    } else if (leavePwa) {
      console.trace(err);
      if (this.pwa.session.isDebug) debugger;
      // Unexpected error. Load canonical site.
      this.noLoad(href);
    }
  }

  /**
   * Returns the document type.
   *
   * @param {URL} urlObj - url to evaluate
   * @returns {Error|String} - Error | "isDiffDomain" | "isNotPwa" | "isAmp" | "isMo"
   */
  loadTypeGet(urlObj) {
    // href is invalid
    if (!urlObj)
      return this.errorCustom(`Cannot load page, invalid href`, urlObj);

    // href is different domain - history.pushState will error
    // (this can happen on staging -> production navigation)
    if (urlObj.hostname !== location.hostname) return "isDiffDomain";

    // href points to currently loaded page
    if (this.session.pageLoad > 0) {
      // alread open in other document object
      for (const docObj of Object.values(this.session.docs)) {
        if (docObj !== this.session.docObjActive && docObj.href == urlObj.href)
          return "isLoadedInOtherDoc";
      }

      // href is current URL
      if (
        this.session.popStateInProgress == false &&
        urlObj.href == location.href
      )
        return this.errorCustom("same url as current url", urlObj.href);

      // href is hash anchor link on the current page,
      // scroll to anchor instead.
      if (
        this.session.popStateInProgress == false &&
        urlObj.href.replace(this.regExp.hash, "") ==
          location.href.replace(this.regExp.hash, "")
      )
        return "isAnchorHashCurrentPage";
    }

    const pathAndSearch = `${urlObj.pathname}${urlObj.search}`;
    const docTests = this.session.docTests;

    // href is not on pwa domain
    // or not in pwa scope
    if (
      docTests.isNotPwaReg.test(pathAndSearch) ||
      !docTests.isPwaHostReg.test(urlObj.hostname)
    )
      return "isNotPwa";

    // Something went wrong with Previous amp fetch
    // and CDN didn't catch error. Can happen during dev.
    if (/wm(No|Skip)Pwa/i.test(urlObj.search)) return "isMo";

    // href is MO page
    if (docTests.isMoReg.test(pathAndSearch)) return "isMo";

    // href is AMP page
    if (docTests.isAmpReg.test(pathAndSearch)) {
      // Set PLP level state for Tealium Analytics
      if (docTests.isPLPReg && docTests.isPLPReg.test(pathAndSearch)) {
        let subPath = urlObj.pathname;
        const isSpecial =
          /^\/store\/category\/(new-arrivals|clearance-savings)/i.test(subPath);
        subPath = subPath.replace(/^\/|\/\d+.*$/gi, "");
        const subPathLength = subPath.split("/").length;

        if (subPathLength == 5 || (isSpecial && subPathLength == 4))
          this.site.tealiumConfig.plpLevel = "l3";
        else if (subPathLength == 4 || (isSpecial && subPathLength == 3))
          this.site.tealiumConfig.plpLevel = "l2";
      }

      // QuickView/ChooseOptions Modal on PLP
      if (urlObj.searchParams.has("quickView"))
        this.quickView.quickViewLoaded = true;

      return "isAmp";
    }

    // href is unknown type -
    // either docTests regex need updated or bad urlObj
    // return this.errorCustom("unknownPageType", urlObj);
    return "isMo";
  }

  /**
   * Modify existing CBCC elements with correct information
   *
   * @param {HTMLElement} ampList - amp-list that has new content
   * @param {Object} prodList - amp state object for product-listing api
   */
  modifyCbccSearch(ampList, prodList) {
    // hide cBccBanner if there are no results
    if (prodList.responseCBCC.concepts == undefined) {
      ampList.closest("body").find(".cBccBanner").hide();
      return;
    }
    let title = "";
    let oldTitle = "";
    let numFound = "";
    try {
      numFound = `${prodList.responseCBCC.concepts[0].numFound
        .toString()
        .replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,")}`;
    } catch (e) {
      console.log(e);
    }

    // create CBCC url with cookie redirect and pathname for filters
    let cBccUrl = prodList.responseCBCC.concepts[0].url.replace(
      /\/store\/s\/.*/,
      ""
    );
    cBccUrl = `/apis/services/cbcc/redirect/v1.0/cookie-redirect?url=${encodeURIComponent(
      `${cBccUrl}${location.pathname}${location.search}`
    )}`;

    // check which domain they provided in the response and update those values
    if (/BuyBuyBaby/.test(prodList.responseCBCC.concepts[0].name)) {
      title = "buybuy BABY";
      oldTitle = /BuyBuyBaby/;
    } else if (/BedBathUS/.test(prodList.responseCBCC.concepts[0].name)) {
      title = "Bed Bath & Beyond";
      oldTitle = /BedBathUS/;
    } else if (/HarmonUS/.test(prodList.responseCBCC.concepts[0].name)) {
      title = "Harmon";
      oldTitle = /HarmonUS/;
      cBccUrl = cBccUrl.replace(/store-\d*(?:%2F)?/, "");
    }

    // if searchlist exists then update both of them, if it doesnt hide the lower banner
    try {
      // update searchTitleList elements
      let searchListLink = ampList.closest("body").find("#cBccSearchLink");
      searchListLink.attr("href", cBccUrl);
      searchListLink.contents()[0].replaceWith(`${title} (${numFound}) `);

      // update CBCC banner elements
      let cBccBannerLink = ampList.closest("body").find(".cBccBanner a");
      cBccBannerLink.attr("href", cBccUrl);
      cBccBannerLink
        .contents()[0]
        .replaceWith(`${title} (${numFound} results) `);
      cBccBannerLink.parent().parent().removeAttr("style");
    } catch (e) {
      // may not exist
      ampList.closest("body").find(".cBccBanner").hide();
    }

    return;
  }

  /**
   * Load the Canonical site without the PWA
   *
   * @param {String} href - The URL that should not be loaded in the PWA
   * @param {Boolean} forever - Whether to permanently exclude the PWA from this device
   */
  noLoad(href, forever = false) {
    if (this.session.isDebug) {
      debugger;
      console.log("Reloading without PWA");
    }

    const urlObj = new URL(href);

    urlObj.searchParams.delete("wmPwa");

    if (forever) {
      // Disable the PWA on this device
      document.cookie =
        "wmNoPwa=true; max-age=604800; path=/; secure"; /* 1 Week */
      document.cookie =
        "wmPwa=true; max-age=0; path=/; secure; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
      urlObj.searchParams.set("wmNoPwa", "true");
      this.sw.unregister();
    } else {
      // Skip this page
      urlObj.searchParams.set("wmSkipPwa", "true");
    }

    if (window.stop) window.stop();

    location.href = urlObj.href;
  }

  /**
   * Scrolls window to historic scroll position if present.
   * Used before unload to remember last position.
   *
   * @param {string} href - href of current document
   */
  scrollPositionRestore(href) {
    if (this.session.appshellVersion == 1) return;

    const state = this.session.history[href] || {
      scrollY: 0,
    };
    window.scroll(0, state.scrollY);
    this.session.history[href] = state;
    // console.log(
    //   "set scroll position",
    //   href,
    //   state.scrollY,
    //   this.session.history
    // );
  }

  /**
   * Gets current scroll position and stores in history.
   * Used before unload to remember last position.
   *
   * @param {string} href - href of current document
   */
  scrollPositionStore(href) {
    if (this.session.appshellVersion == 1) return;

    this.session.history = this.session.history || {};
    const state = this.session.history[href] || {};
    state.scrollY = window.scrollY;
    this.session.history[href] = state;
    // console.log(
    //   "get scroll position",
    //   href,
    //   state.scrollY,
    //   this.session.history
    // );
  }

  /**
   * Handles "scrollTo" click events
   * @param {HTMLBodyElement} ampBody - amp body element
   * @param {Element} target - html element to scroll to
   * @param {Event} unusedEvent - click event
   */
  scrollToHandler(ampBody, target, unusedEvent) {
    this.util.scrollIntoView(ampBody, target);
  }

  /**
   * Modify this.session. ex:
   *    - Complex regular expression building
   *    - Modifying this.session with Async calls to user endpoints and such.
   *
   * this.session stores routing configuration
   * and user-specific data during the PWA session.
   *
   * @param {sessionObject} pwaSessionInit
   *  - if you pass pwaSessionInit in the appshell,
   *    those settings will override the settings defined here.
   *
   */
  sessionInit(pwaSessionInit) {
    pwaSessionInit = pwaSessionInit || {};

    this.session.appshellVersion =
      document.body.getAttribute("data-version") || 1;

    /* let the browser know we will be setting scroll on page nav */
    history.scrollRestoration = "manual";

    // option to overwrite with Appshell's window.pwaSessionInit.
    // doing this before ampHosting version below so we can cachebust amp pages
    // in Cloudflare PWA.
    Object.assign(this.session, pwaSessionInit);

    // Brand URLs with missing trailing slash are scattered throughout
    // the site: in menu, SAYT responses, and PDPs.
    // This causes problems when parsing facets from the pathname
    // and also leads to duplicate brand URLs in the cache.
    // Add trailing slash to all root brand links without filters applied
    this.session.docTests.isUnclosedBrandReg =
      /^\/store\/brand\/[^\/]+?\/[^\/]+$/i;

    // Identify brand pages for site.parseUrl (& maybe future)
    this.session.docTests.isBrandReg = /^\/store\/brand/i;

    if (/wmPwa/i.test(location.search)) {
      // Enable staging logging if opt-in param is set
      this.session.isStaging = true;

      // PDP product listing ad - "other products that fit your search"
      if (/wmPla/i.test(location.search)) this.session.features.pdpPla = true;
      // Enable full navigation in prod if user has opted in w/ ?wmPwa
      // this.session.docTests.isMoReg = /(\?|&)(type=(personalize|protectionPlan)|personalize=true)/i;
    }

    if (/wmNoFetch/i.test(location.search)) {
      this.session.isNoFetch = true;
    }

    // JW - 4.7.21 - override isPDPReg temporarily while we transition to PDPv2 womp
    this.session.docTests.isPDPReg = /\/store\/product\//i;

    // JW - 5.25.21 Protect against someone accidentally deleting old home womp
    this.session.docTests.isHomeReg = /^\/(store)?\/?(\?.*)?$/i;

    // 2.12.21 - Temp - exclude PDPs for Desktop and Tablet
    this.session.isMobile = this.session.userAgentConfig.mobile.reg.test(
      navigator.userAgent
    );

    this.session.isDebug = /wmDebug/i.test(location.search);

    // 5.28.21 - TEMP Enable transition to feature switching via appshell config
    // 6.17.21 - Removed TEMP enablings from object - JP
    this.session.features = this.session.features || {};
    // 6.24.21 TEMP - enable in preprod until site config includes them
    //this.session.features.siteCbccEnabled = this.session.isPreprod;
    // PPS-2305 - pending config update for appshell before render
    // this.session.features.siteCbccHarmonEnabled = this.session.isPreprod;

    if (/wmPdpList/i.test(location.search))
      this.session.features.pdpShoppingList = true;

    // 7.8.21 Preview wm-optimized pages with wmOptimized parameter
    if (/wmOptimized/i.test(location.search))
      this.session.ampHost = `${this.session.ampHost}/wm-optimized`;

    // https://bedbathandbeyond.atlassian.net/browse/PPS-2249
    if (/wmTopAd/i.test(location.search))
      this.session.features.plpAboveFoldAd = true;

    if (/wmPlpList/i.test(location.search))
      this.session.features.plpShoppingList = true;

    if (/wmPreorder/i.test(location.search))
      this.session.features.sitePreorder = true;

    if (/wmBackorder/i.test(location.search))
      this.session.features.siteBackorder = true;

    if (/wmIdeaboardV2/i.test(location.search))
      this.session.features.ideaboardV2 = true;

    // PDP product listing ad - "other products that fit your search"
    if (/wmPla/i.test(location.search)) this.session.features.pdpPla = true;

    if (/wmAtcModalV2/i.test(location.search))
      this.session.features.atcEditQuantity = true;

    // PLP left column test
    function cookieGet(name) {
      var match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
      if (match) return match[2];
    }
    if (
      this.session.docTests.isPLPReg.test(location.href) ||
      this.session.docTests.isSearchReg.test(location.href)
    ) {
      this.session.firstLoad = true;
    }

    // const wmPlpLeftCookie = cookieGet("wmPlpFilterTest");
    // if (/wmPlpLeft/i.test(location.search) || wmPlpLeftCookie == "left")
    //   this.session.features.plpLeft = true;
    // else if (wmPlpLeftCookie == "control")
    //   this.session.features.plpLeft = false;
    // this.session.features.plpLeft = true;

    // PDP product listing ad - "other products that fit your search"
    if (/wmPla/i.test(location.search)) this.session.features.pdpPla = true;
  }
}

class Registry {
  /**
   * Site interface specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    /* reference to pwa coordinating class */
    this.pwa = pwa;

    this.registryItemAddedModal = {
      data: null,
      dom: null,
      template: null,
    };
    this.registryCta = {
      data: null,
      dom: null,
      template: null,
    };
    this.registryFooter = {
      data: null,
      dom: null,
      template: null,
    };
    this.registryNav = {
      data: null,
      dom: null,
      template: null,
    };
    this.registrySidebar = {
      data: null,
      dom: null,
      template: null,
    };

    // registry constants
    this.caRegistryTypeIds = {
      BA1: "300003",
      BRD: "300001",
      COL: "300006",
      HSW: "300004",
    };
    this.registryTypeIds = {
      BA1: "200007",
      BRD: "200001",
      COL: "200005",
      HSW: "200004",
    };

    this.refConfig = {
      Wedding: "48316",
      Baby: "48342",
      Birthday: "48334",
      Retirement: "48334",
      Anniversary: "48334",
      Housewarming: "48334",
      "College/University": "48338",
      University: "48338",
      "Commitment Ceremony": "48316",
      Other: "48334",
      refID_BBY: "0",
      refID_REG: "0",
    };

    this.registryFooterClickHandler =
      this.registryFooterClickHandler.bind(this);
    this.registrySideBarClickHandler =
      this.registrySideBarClickHandler.bind(this);

    // add function to interactionParamRouter
    if (this.pwa.user.hasRegistry) {
      try {
        this.pwa.site.interactions.push({
          paramKey: "action",
          paramVal: "appointment",
          handler: this.bookAppointmentRouted,
          thisArg: this,
          stopNav: true,
        });
      } catch (e) {
        console.warn(
          `Registry: Constructor, Could not add to param router Error: ${e}`
        );
      }
    }

    this.init();
  }

  /****************************/
  /*** Render trigger paths ***/
  /****************************/

  /**
   * Change active registry in footer, nav, and sidebar
   * @param {CashJsCollection} ampBody$ - AMP body
   * @returns undefined
   */
  async activeRegistryChange(ampBody$, registryId) {
    // 1. clear "rendered" toggles (stickyFooter, sideBar) from body
    let ampBody = ampBody$[0];
    this.registryFooter.rendered = false;
    ampBody.registryNavRendered = false;
    ampBody.registrySidebarRendered = false;

    this.registryFooter.data = undefined;
    this.registryNav.data = undefined;
    this.registrySidebar.data = undefined;
    this.registryStoreFinderModal.data = undefined;

    // 2. Fetch some new data for sidebar and footer, update this class
    try {
      const bodyParams = `registryId=${registryId}`;
      await fetch(`${location.origin}/apis/stateful/v1.0/registry/active`, {
        method: "PUT",
        headers: Object.assign(
          {
            accept: "application/json, text/plain, */*",
            "atg-rest-depth": 2,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          await this.pwa.user.sessionConfirmationHeadersGetOrSet()
        ),
        body: bodyParams,
      });
    } catch (e) {
      console.warn(`Failed to call active registry change API. Error: ${e}`);
    }

    // 3. re-render with new data on class data objects
    this.registryAllRender(ampBody$, location);
  }

  /**
   * Depending on registry data availability:
   *  Reserve space for components (first page)
   *  or render components in DOM (second page)
   * @param {CashJsCollection} ampDoc$ - AMP document
   * @returns undefined
   */
  ampBeforeRender(ampDoc$, urlObj, ampBody$) {
    if (
      !this.pwa.user.hasRegistry ||
      !this.pwa.session.registryAssetsPrefetch
    ) {
      if (
        this.pwa.user.hasAcct &&
        this.ownRecommended &&
        this.ownRecommended.data &&
        this.ownRecommended.data.recommendedRegistryList
      )
        this.registryCtaBeforeRender(ampDoc$, urlObj);
      return;
    }

    // flag for multiple registries, render menu, set to false here in case of navigation bugs
    this.renderCtaMenuFlag = false;
    /*
      Since CTA is in an ampList, we can't render until the list renders.
      Either way, we should reserve space as we know there is an active registry
    */
    this.ampBeforeRenderReserveSpace(ampDoc$, urlObj);
  }

  /**
   * Reserve space for registry components before document is attached to the DOM
   * This includes setting height of the fulfillment list, and
   * adding the container if it does not exist
   * @param {CashJsCollection} ampDoc$ - AMP document
   * @param {Object} urlObj - url that is currently active
   * @returns undefined
   */
  ampBeforeRenderReserveSpace(ampDoc$, urlObj) {
    if (!this.isRegistryPage(urlObj)) return;

    // add space for registryFooterElement
    if (window.innerWidth < 1024)
      ampDoc$.find("#wm_footer").addClass("hasRegistryFooter");

    // Reserve CTA space in PDP
    this.registryCtaBeforeRender(ampDoc$, urlObj);
  }

  /**
   *
   * @param {CashJsCollection} ampBody$ - ampBody that is in before render phase
   * @returns {Boolean} - Success
   * This is a function to add the dom elements needed to display the registry CTA buttons
   * This is for the interim between the PWAMP is deployed, and the new pages build
   * Can be removed end of January. Just check that PLP and PDP pages have .registryCtaCont elements
   */
  backfillPdpCta(ampBody$) {
    if (this.pwa.$$$(ampBody$[0], ".registryCtaCont").length == 0) {
      $(this.pwa.$$$(ampBody$[0], ".pdpQtyInputCont")).each(function () {
        if ($(this).closest("amp-list").length == 0) {
          $(this).next("div.s9").addClass("fulfillCtaCont");
          $(this).after(
            `<div id="registryCtaCont" class="s12 vt1 wHide parent registryCtaCont">
                <button class="btn btnLrg btnPrimary s12 registryCta{{^bopisAvailable}} bopisOOS{{/bopisAvailable}}{{^ONLINE_INVENTORY}} shipItOOS{{/ONLINE_INVENTORY}}" data-click-handler="registry.registryCtaClick"
                [class]="'btn btnLrg btnPrimary s12 registryCta{{^bopisAvailable}} bopisOOS{{/bopisAvailable}}{{^ONLINE_INVENTORY}} shipItOOS{{/ONLINE_INVENTORY}} ' + pdpCtaType">
                    Add to Registry
                    <svg viewBox="0 0 12.01 6.15" class="wi wiCaret g05 noTap"> <path d="M6 6.15a1.07 1.07 0 01-.6-.2l-5-4.2A1 1 0 01.25.35a1 1 0 011.4-.1L6 3.85l4.4-3.6a1 1 0 011.4.1 1 1 0 01-.1 1.4L6.65 6a1.85 1.85 0 01-.65.15z"></path> </svg>
                  </button>
              </div>`
          );
        }
      });

      return true;
    }
    return false;
  }

  /**
   *
   * @param {CashJsCollection} ampBody$ - ampBody that is in before render phase
   * @returns {Boolean} - Success
   * This is a function to add the dom elements needed to display the registry CTA buttons
   * This is for the interim between the PWAMP is deployed, and the new pages build
   * Can be removed end of January. Just check that PLP and PDP pages have .registryCtaCont elements
   */
  backfillPlpCta(ampBody$) {
    if (this.pwa.$$$(ampBody$[0], ".registryCtaCont").length == 0) {
      let regEle = `{{^MARKETPLACE_ITEM_FLAG}}
        {{^CUSTOMIZATION_OFFERED_FLAG_boolean}}
          {{^MSWP_FLAG}}
              <!-- Registry -->
              <div class="s12 vt1 parent registryCtaCont {{^inventoryStatus_boolean}} shipItOOS{{/inventoryStatus_boolean}}{{^availableInStore}} bopisOOS{{/availableInStore}}"
              data-prod-reg='{"prodId": "{{PRODUCT_ID}}", "skuId":"{{SKU_ID.0}}", "price": "{{isPriceRangeStr}}", "parentProdId": "{{PRODUCT_ID}}", "title": "{{DISPLAY_NAME}}", "prodImg": "{{SCENE7_URL}}"}'
              [class]="
              's12 vt1 parent registryCtaCont {{^inventoryStatus_boolean}} shipItOOS{{/inventoryStatus_boolean}}{{^availableInStore}} bopisOOS{{/availableInStore}}' + (
                  (
                      '{{COLLECTION_FLAG}}' == '1'
                  )
                  ? ' hide'
                  : ''
              )">
                  <button class="btn btnLrg btnPrimary s12 registryCta" data-click-handler="registry.registryCtaClick"  data-reg-item='{qty:1,skuId:"{{#skuSelected}}{{skuSelected}}{{/skuSelected}}{{^skuSelected}}{{SKU_ID.0}}{{/skuSelected}}",prodId:"{{PRODUCT_ID}}",type:"registry"}'>
                      Add to Registry
                      <svg viewBox="0 0 12.01 6.15" class="wi wiCaret g05 noTap"> <path d="M6 6.15a1.07 1.07 0 01-.6-.2l-5-4.2A1 1 0 01.25.35a1 1 0 011.4-.1L6 3.85l4.4-3.6a1 1 0 011.4.1 1 1 0 01-.1 1.4L6.65 6a1.85 1.85 0 01-.65.15z"></path> </svg>
                  </button>
              </div>
            {{/MSWP_FLAG}}
          {{/CUSTOMIZATION_OFFERED_FLAG_boolean}}
        {{/MARKETPLACE_ITEM_FLAG}}
      `;
      $(this.pwa.$$$(ampBody$[0], ".prodCardR .grow1")).after(regEle);
      regEle = regEle.replace(
        /registryCtaCont /gi,
        "registryCtaCont sswp{{TYPE}} "
      );
      $(this.pwa.$$$(ampBody$[0], ".epCellCtaLink")).after(regEle);
      return true;
    }
    return false;
  }

  /**
   * make an object for book an appointment iframe src url to make sure the values are correct
   */
  async bookAppointmentDataGet() {
    let regData = await this.registryNavDataGet();
    let activeReg = regData.data.activeRegistry;
    return {
      fn: activeReg.primaryRegistrantFirstName || "",
      ln:
        activeReg.primaryRegistrantLastName == "masked"
          ? "false"
          : activeReg.primaryRegistrantLastName || "",
      coFn: activeReg.coRegistrantFirstName || "false",
      coLn:
        activeReg.coRegistrantLastName == "masked"
          ? "false"
          : activeReg.coRegistrantLastName || "false",
      email: /\*/.test(activeReg.primaryRegistrantEmail)
        ? "false"
        : activeReg.primaryRegistrantEmail || "",
      coEmail: /\*/.test(activeReg.coRegistrantEmail)
        ? "false"
        : activeReg.coRegistrantEmail || "",
      num: activeReg.primaryRegistrantPrimaryPhoneNum || "false",
      regId: activeReg.registryId || "",
      date: activeReg.eventDate || "",
      eventType: activeReg.eventType || "",
    };
  }

  /**
   * creates template for the book appointment modal
   * @param {CashJsCollection} storeId - id of selected store
   */
  async bookAppointmentIframeModalTemplate(storeId) {
    // construct data for template
    let reg = await this.bookAppointmentDataGet();
    let siteId = this.pwa.session.isBBB_US
      ? 1
      : this.pwa.session.isBABY
      ? 2
      : 3;
    let url = `https://bespoke.bookingbug.com/bbb${
      this.pwa.session.isPreprod ? "/staging" : ""
    }/new_booking.html?abc=1&siteId=${siteId}&storeId=${storeId}&regFN=${
      reg.fn
    }&regLN=${reg.ln}&coregFN=${reg.coFn}&coregLN=${reg.coLn}&email=${
      reg.email
    }&coregEmail=${reg.coEmail}&contactNum=${reg.num}&registryId=${
      reg.regId
    }&eventDate=${reg.date}&catID=${
      this.refConfig[reg.eventType]
        ? `&preselectedServiceRef=${this.refConfig[reg.eventType]}`
        : ""
    }`;

    // book appointment modal template
    let bookModal = /*html*/ `
      <style>
        .bAHead {
          font: 600 20px/1.4 var(--fontMain);
        }
      </style>
      <div id="bookAppointmentIframeModal" class="modal active">
        <div class="modalContent h100">
          <button class="btn modalClose" data-click-handler="registry.closeModal" data-modal-close aria-label="Close Modal" type="button">
            <svg class="wi wiClose noTap">
              <use xlink:href="#wiClose"></use>
            </svg>
          </button>
          <div class="modalContentInner flex col h100">
            <div class="vb1 txtCtr bAHead">Great! Let's book an appointment.</div>
            <div class="grow1 h100">
              <iframe
                class="s12 h100"
                src=${url}
              >
              </iframe>
            </div>
          </div>
        </div>
      </div>
    `;

    return bookModal;
  }

  // handle any clicks on the book appointment store finder modal's radius modal
  bookAppointmentRadiusModalClick(argString, target$) {
    if (target$.is(".registryCsRadBtn")) {
      let radiusModal = target$.closest(".modal").find(".registryRadiusModal");
      radiusModal.toggleClass("active");
      radiusModal.find(".registryRadiusBtn.active").removeClass("active");
      let curVal = target$.find(".registryRadius").text();
      radiusModal.find(`[data-value='${curVal}']`).addClass("active");
    }

    if (target$.is(".registryRadiusBtn")) {
      target$
        .closest("#modalRegistryStoreFinder")
        .find(".registryRadius")
        .text(target$.attr("data-value"));
      this.closeModal("false", target$);
    }
  }

  /**
   * renders template for the book appointment modal
   * @param {CashJsCollection} storeId - id of selected store
   */
  async bookAppointmentRender(storeId, target$) {
    if (target$ && target$.length) {
      this.closeModal("true", target$);
    }
    try {
      let bookModal = await this.bookAppointmentIframeModalTemplate(storeId);
      $(this.pwa.session.docObjActive.shadowBody).append(bookModal);
    } catch (e) {
      console.warn(
        `Registry, bookAppointment: Couldn't add to shadowbody. Error: ${e}`
      );
    }
  }

  /**
   * interactionParamRouted function to handle opening bookAppointment modal
   */
  async bookAppointmentRouted() {
    if (window.innerWidth >= 1024) return;
    let [navData, mustache, docObj] = await Promise.all([
      this.registryNavDataGet(),
      this.pwa.util.waitForProp("Mustache"),
      this.pwa.util.waitForProp("docObjActive", this.pwa.session),
    ]);
    if (navData && navData.data && navData.data.activeRegistry.favStoreId) {
      this.bookAppointmentRender(navData.data.activeRegistry.favStoreId);
    } else {
      this.bookAppointmentStoreFinderRender();
    }
  }

  // shows all store hours
  bookAppointmentSeeMoreClick(argString, target$) {
    target$.closest(".registrySeeMore").addClass("active");
  }

  // handle user click on the store finder modal
  bookAppointmentStoreModalClick(argString, target$) {
    let form = target$.find(".registryStoreForm");
    // only handle click if target$contains form
    if (form.length) {
      if (form.find("#registryClFormLocale").val() !== "") {
        form.removeClass("formErr");
      }

      // close radius modal if open
      target$.find(".registryRadiusModal").removeClass("active");
    }
  }

  // render book appointment store finder modal
  async bookAppointmentStoreFinderRender() {
    await this.pwa.util.waitForProp("registryStoreFinderModal", this);
    $("body").addClass("modalOpen");
    let data = {
      geoLevel: this.pwa.session.isCANADA
        ? "City and Province, or Postal Code"
        : "City and State, or Zip",
      isCA: this.pwa.session.isCANADA,
      isBABY: this.pwa.session.isBABY,
      measurement: this.pwa.session.isCANADA ? "km" : "miles",
      storeFinder: true,
    };
    try {
      const registryStoreFinderHtml = Mustache.render(
        this.registryStoreFinderModal.template,
        data
      );
      $(this.pwa.session.docObjActive.shadowBody).append(
        registryStoreFinderHtml
      );
    } catch (e) {
      console.warn(
        `Registry, bookAppointmentStoreFinderRender: Couldn't add to shadowbody. Error: ${e}`
      );
    }
  }

  // modify data recieved from radius api to make mustache render easier
  bookAppointmentStoreDataModify(data) {
    data.searchResults.forEach((itm) => {
      let bopisFlag = 0;
      try {
        let regex = new RegExp(
          `{"bopusFlag":\\s"(\\d)","siteId":\\s"${this.pwa.session.siteId}"}`
        );
        bopisFlag = parseInt(regex.exec(itm.fields.siteBopus)[1]);
      } catch (e) {}
      itm.fields.bopisFlag = bopisFlag;
      itm.distance = parseFloat(itm.distance).toFixed(1);
      itm.fields.hours = itm.fields.hours.split(",");
      itm.unitDistance = this.pwa.session.isCANADA ? "km" : "miles";
    });
  }

  // Get store information and render the results from user interation
  async bookAppointmentStoreResultsRender(argString, target$, event) {
    let loc = "";
    let resultCont = "";
    let form = target$
      .closest("#modalRegistryStoreFinder")
      .find(".registryStoreForm");
    let isCA = this.pwa.session.isCANADA;

    // determine location based off which button was pressed
    if (target$.is(".registryCurrLocBtn")) {
      loc = await this.pwa.site.getCurrentLocation();
      resultCont = ".storeResults";
    }
    if (target$.is(".registryStoreFinderSubmit")) {
      let input = form.find("#registryClFormLocale");
      if (input.val() == "") {
        form.addClass("formErr");
        return;
      } else {
        form.removeClass("formErr");
        loc = input.val();
        resultCont = ".modalContentInner";
      }
    }
    let radius = target$.closest(".modal").find(".registryRadius").text();
    let radiusUrl = `https://www.mapquestapi.com/search/v2/radius?key=Gmjtd%7Clu6120u8nh,2w%3Do5-lwt2l&inFormat=json&json=%7B%22origin%22:%22${loc}%22,%22hostedDataList%22:[%7B%22extraCriteria%22:%22(+%5C%22display_online%5C%22+%3D+%3F+)+and+(+%5C%22store_type%5C%22+%3D+%3F+${
      isCA ? "or+%5C%22country%5C%22+%3D+%3F+" : ""
    })%22,%22tableName%22:%22mqap.34703_AllInfo${
      this.pwa.session.isPreprod ? "_dev" : ""
    }%22,%22parameters%22:[%22Y%22,%22${
      isCA ? "50%22,%22CA%22" : "10%22"
    }],%22columnNames%22:[]%7D],%22options%22:%7B%22radius%22:%22${radius}%22,%22maxMatches%22:${
      isCA ? "100" : "20"
    },%22ambiguities%22:%22ignore%22,%22units%22:%22${
      isCA ? "k" : "m"
    }%22%7D%7D`;

    let dataFetch = await fetch(radiusUrl);
    let data = await dataFetch.json();

    // if there is no data in the response, the input is most likely bad
    if (!data.searchResults) {
      form.addClass("formErr");
      return;
    }
    this.bookAppointmentStoreDataModify(data);

    const registryResultsHtml = Mustache.render(
      this.registryStoreFinderModal.template,
      data
    );

    // add the results to the correct section of the modal
    target$
      .closest("#modalRegistryStoreFinder")
      .find(resultCont)
      .html(registryResultsHtml);
  }

  async checkListToggleModalClick(argString, target$) {
    // reset navData if user closed modal with the toggle on
    if (target$.is(".modalClose")) {
      if (!target$.parent().find("checklistOff").length) {
        this.registryNav.data = undefined;
      }
      this.closeModal("true", target$);
      return;
    }

    target$.parent().toggleClass("checklistOff");

    let json = {};
    let formData;
    try {
      let data = await this.registryNavDataGet();

      let curRegData = await this.checkListToggleModalDataGet(
        data.data.activeRegistry.registryId
      );
      let favStoreId =
        curRegData.data.registryResVO.registrySummaryVO.favStoreId;
      let date = curRegData.data.registryResVO.registrySummaryVO.eventDate;
      curRegData = curRegData.data.registryResVO.registryVO;
      // create json object for toggling checklist
      json = {
        "sessionBean.registryTypesEvent":
          curRegData.registryType.registryTypeName,
        "registryVO.registryId": curRegData.registryId,
        "registryVO.coRegistrant.firstName":
          curRegData.coRegistrant.firstName || "",
        "registryVO.primaryRegistrant.cellPhone":
          curRegData.primaryRegistrant.primaryPhone || "",
        "registryVO.primaryRegistrant.firstName":
          curRegData.primaryRegistrant.firstName,
        "registryVO.primaryRegistrant.lastName":
          curRegData.primaryRegistrant.lastName,
        "registryVO.primaryRegistrant.babyMaidenName":
          curRegData.event.babyName || "",
        "registryVO.primaryRegistrant.contactAddress.firstName":
          curRegData.primaryRegistrant.contactAddress.firstName,
        "registryVO.primaryRegistrant.contactAddress.lastName":
          curRegData.primaryRegistrant.contactAddress.lastName,
        "registryVO.primaryRegistrant.primaryPhone":
          curRegData.primaryRegistrant.primaryPhone,
        "registryVO.refStoreContactMethod": "",
        "registryVO.registryType.registryTypeName":
          curRegData.registryType.registryTypeName,
        updateSimplified: true,
        "registryVO.prefStoreNum": favStoreId,
        "registryVO.primaryRegistrant.contactAddress.addressLine1":
          curRegData.primaryRegistrant.contactAddress.addressLine1,
        "registryVO.primaryRegistrant.contactAddress.addressLine2":
          curRegData.primaryRegistrant.contactAddress.addressLine2,
        "registryVO.primaryRegistrant.contactAddress.city":
          curRegData.primaryRegistrant.contactAddress.city,
        "registryVO.primaryRegistrant.contactAddress.state":
          curRegData.primaryRegistrant.contactAddress.state,
        "registryVO.primaryRegistrant.contactAddress.zip":
          curRegData.primaryRegistrant.contactAddress.zip,
        "registryVO.primaryRegistrant.contactAddress.poBoxAddress":
          curRegData.primaryRegistrant.contactAddress.poBoxAddress || "",
        "registryVO.primaryRegistrant.contactAddress.qasValidated":
          curRegData.primaryRegistrant.contactAddress.qasValidated,
        "registryVO.shipping.shippingAddress.addressLine1":
          curRegData.shipping.shippingAddress.addressLine1,
        "registryVO.shipping.shippingAddress.addressLine2":
          curRegData.shipping.shippingAddress.addressLine2,
        "registryVO.shipping.shippingAddress.city":
          curRegData.shipping.shippingAddress.city,
        "registryVO.shipping.shippingAddress.firstName":
          curRegData.shipping.shippingAddress.firstName,
        "registryVO.shipping.shippingAddress.lastName":
          curRegData.shipping.shippingAddress.lastName,
        "registryVO.shipping.shippingAddress.state":
          curRegData.shipping.shippingAddress.state,
        "registryVO.shipping.shippingAddress.qasValidated":
          curRegData.shipping.shippingAddress.qasValidated,
        regContactAddress: "",
        shippingAddress: "shipAdrressSameAsRegistrant",
        futureShippingAddress: "",
        "registryVO.shipping.shippingAddress.zip":
          curRegData.shipping.shippingAddress.zip || "",
        "registryVO.shipping.shippingAddress.poBoxAddress":
          curRegData.shipping.shippingAddress.poBoxAddress || "",
        "registryVO.shipping.futureShippingAddress.addressLine1": curRegData
          .shipping.futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.addressLine1 || ""
          : "",
        "registryVO.shipping.futureShippingAddress.addressLine2": curRegData
          .shipping.futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.addressLine2 || ""
          : "",
        "registryVO.shipping.futureShippingAddress.city": curRegData.shipping
          .futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.city || ""
          : "",
        "registryVO.shipping.futureShippingAddress.firstName": curRegData
          .shipping.futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.firstName || ""
          : "",
        "registryVO.shipping.futureShippingAddress.lastName": curRegData
          .shipping.futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.lastName || ""
          : "",
        "registryVO.shipping.futureShippingAddress.state": curRegData.shipping
          .futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.state || ""
          : "",
        "registryVO.shipping.futureShippingAddress.country": curRegData.shipping
          .futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.country || ""
          : "",
        "registryVO.shipping.futureShippingAddress.qasValidated": curRegData
          .shipping.futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.qasValidated
          : "",
        "registryVO.shipping.futureShippingAddress.zip": curRegData.shipping
          .futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.zip || ""
          : "",
        "registryVO.shipping.futureShippingAddress.poBoxAddress": curRegData
          .shipping.futureshippingAddress
          ? curRegData.shipping.futureshippingAddress.poBoxAddress || ""
          : "",
        "registryVO.shipping.futureShippingDate":
          curRegData.shipping.futureShippingDate || "",
        futureShippingDateSelected: "",
        "registryVO.coRegistrant.email":
          curRegData.coRegistrant.email == "masked"
            ? null
            : curRegData.coRegistrant.email
            ? encodeURIComponent(curRegData.coRegistrant.email)
            : "",
        "registryVO.primaryRegistrant.email":
          curRegData.primaryRegistrant.email == "masked"
            ? null
            : curRegData.primaryRegistrant.email
            ? encodeURIComponent(curRegData.primaryRegistrant.email)
            : "",
        "registryVO.networkAffiliation": curRegData.networkAffiliation,
        "registryVO.event.guestCount": curRegData.event.guestCount,
        "registryVO.event.babyGender": curRegData.event.babyGender,
        "registryVO.coRegistrant.lastName":
          curRegData.coRegistrant.contactAddress.lastName || "",
        "registryVO.event.eventDate": date,
        "registryVO.event.showerDate": curRegData.event.showerDate || "",
        "registryVO.regBG": curRegData.regBG || "",
        "registryVO.coRegBG": curRegData.coRegBG || "",
        "registryVO.event.babyNurseryTheme":
          curRegData.event.babyNurseryTheme || "",
        "registryVO.coRegOwner": false,
        makeRegistryPublic: true,
        deactivateRegistry: false,
        coRegEmailFoundPopupStatus: false,
        coRegEmailNotFoundPopupStatus: false,
        "registryVO.event.college": curRegData.event.college || "",
        showChecklist: argString == "on" ? true : false,
      };
      formData = Object.keys(json)
        .map((key) => key + "=" + json[key])
        .join("&");
    } catch (e) {
      console.warn(
        `Registry: checklistToggleModalClick. Could not get all registries data. Error: ${e}`
      );
      return;
    }

    let regEdit = await this.pwa.util.statefulFetch(
      `${location.origin}/apis/stateful/v1.0/registry/edit`,
      {
        body: formData,
        credentials: "include",
        method: "PUT",
        headers: Object.assign(
          {
            "atg-rest-depth": 2,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          await this.pwa.user.sessionConfirmationHeadersGetOrSet()
        ),
      }
    );
    // RL - todo add code to redirect to login if user has dropped to security status 2
  }
  async checkListToggleModalDataGet(registryId) {
    if (this.registryStoreFinderModal && this.registryStoreFinderModal.data) {
      return this.registryStoreFinderModal.data;
    }

    // let headers = await this.pwa.user.sessionConfirmationHeadersGetOrSet();
    // headers["atg-rest-depth"] = "7";
    this.registryStoreFinderModal.data = await this.pwa.util.statefulFetch(
      `${location.origin}/apis/stateful/v2.0/registry/${registryId}`,
      {
        body: "isGiftGiver=false&formRegistryController=true",
        credentials: "include",
        method: "POST",
        headers: Object.assign(
          await this.pwa.user.sessionConfirmationHeadersGetOrSet(),
          {
            "atg-rest-depth": "7",
            "Content-Type": "application/x-www-form-urlencoded",
          }
        ),
      }
    );

    return this.registryStoreFinderModal.data;
  }

  checkListToggleModalRender(ampBody$) {
    let template = this.checkListToggleModalTemplate();
    ampBody$.append(template);
  }
  checkListToggleModalTemplate() {
    let toggleOnImg = this.pwa.session.isBABY
      ? "baby-toggle-on.png"
      : "bbb-toggle-on.png";
    return /*html*/ `
    <div id="modalRegistryChecklistToggle" class="modal active" tabindex="-1">
      <style>
        .checkListToggleHead{
          color: #002855;
          font: 600 24px/1.25 var(--fontDisplay);
          margin-top: 316px;
        }
        .babyChecklistToggle .checkListToggleHead{
          color: #000;
          font: 500 24px/1.25 var(--fontMain);
        }
        .checklistToggleTxt {
          font-weight: 300;
          line-height: 1.2;
        }
        .babyChecklistToggle .checklistToggleTxt {
          font-size: 16px;
          line-height: 1.37;
        }
        .toggleOff,
        .checklistOff .toggleOn {
          display: none;
        }
        .checklistOff .toggleOff{
          display: block;
        }
        .babyChecklistToggle .checklistVisible {
          font: 500 14px/1.43 var(--fontMain);
        }
      </style>
      <div class="modalContent flex mid col ${
        this.pwa.session.isBABY ? "babyChecklistToggle" : ""
      }">
        <button class="btn modalClose" data-click-handler="registry.checkListToggleModalClick()" data-modal-close aria-label="Close Modal" type="button">
          <svg class="wi wiClose noTap">
            <use xlink:href="#wiClose"></use>
          </svg>
        </button>
        <div class="vb05 checkListToggleHead">Checklist</div>
        <div class="vb025 checklistToggleTxt">Your checklist is turned off.</div>
        <div class="vb05 checklistToggleTxt">Turn it back on by selecting the toggle below.</div>
        <div class="flex mid checklistOff">
          <img src="/static/assets/images/toggle-off.png" alt="toggle-off" class="gr05 h100 toggleOff" data-click-handler="registry.checkListToggleModalClick(on)">
          <img src="/static/assets/images/${toggleOnImg}" alt="toggle-on" class="gr05 h100 toggleOn" data-click-handler="registry.checkListToggleModalClick(off)">
          <h6 class="bold checklistVisible">Checklist Visibility</h6>
        </div>
      </div>
    </div>
    `;
  }

  /**
   * close modal from data-click-handler or function call, may be useful elsewhere
   * @param {String} remove - string true to remove, string false to remove active class
   * @param {CashJsCollection} target$ - Event target
   */
  closeModal(remove, target$) {
    if (remove == "true") target$.closest(".modal").remove();
    else target$.closest(".modal").removeClass("active");
  }

  /**
   * Click handler for PDP registry CTA
   * @param {CashJsCollection} target$ - Event target
   * @returns undefined
   */
  async registryCtaClick(str, target$) {
    if (!this.registryCta.data) return false;
    if (
      this.ownRecommended.data.recommendedRegistryList.length ||
      this.registryCta.data.data.registryList.length > 1
    ) {
      // open or close registry menu
      this.registryCtaMenuRender(target$);
    } else {
      target$.addClass("noTap");
      target$.attr("data-modal-open", "true");
      // add to registry
      this.pwa.util.scrollToggle(this.pwa.session.docObjActive, target$);
      let regIdStr = this.registryCta.data.data.activeRegistry.registryId;
      this.registrySendCtaBeacon(regIdStr, target$);
      await this.registryItemAddedModalRender(regIdStr, target$);
      target$.removeAttr("data-modal-open");
      target$.removeClass("noTap");
    }
    return true;
  }

  /**
   * @param {CashJs Object} ele$ - cashJs node that will be anchor for item
   * @returns {Boolean} - Whether the anchor item is located above or below the vertical center of the window
   * Useful for calculating to open a dropdown above or below the anchor
   */
  aboveVertCenter(ele$) {
    var rect = ele$[0].getBoundingClientRect();
    return rect.top > -1 && rect.top <= $(window).height() / 2;
  }

  async registrySendCtaBeacon(regIdStr, target$) {
    try {
      const isPDP = this.pwa.session.docTests.isPDPReg.test(location.pathname);
      const isPLP = this.pwa.session.docTests.isPLPReg.test(location.pathname);

      const ampBody = this.pwa.session.docObjActive.shadowBody;
      const clone = target$.clone();

      const [regItems] = isPDP
        ? await this.createPdpRegObj(regIdStr, target$)
        : await this.createPlpRegObj(regIdStr, target$);

      let [skuDet, pdpDet] = isPDP
        ? await Promise.all([
            this.pwa.pdpDataAbstraction.getSkuDetails(),
            this.pwa.pdpDataAbstraction.getPDPState("pdpDet"),
            // this.pwa.pdpDataAbstraction.getPDPState("skuFacets"),
          ])
        : [];

      let plpProdDet = await this.pwa.plp.getPlpItemData(regItems.prodId);

      const prodDet = pdpDet ? pdpDet.data.PRODUCT_DETAILS : {};

      const reg = this.registryCta.data.data.registryList.filter((reg) => {
        return reg.registryId == regIdStr;
      })[0];

      let cta;
      let beaconData;
      if (isPDP) {
        cta = "pdpAddToRegistry";

        beaconData = {
          inventory_status: skuDet.ONLINE_INVENTORY
            ? "in stock"
            : "out of stock",
          // personalization_type: undefined,
          product_category: [prodDet.CATEGORY_BREADCRUMBS[0].name],
          product_has_personalization: [
            skuDet.CUSTOMIZATION_OFFERED_FLAG_boolean,
          ],
          product_image_name: [skuDet.PRODUCT_IMG_ARRAY[0].description],
          product_image_url: [
            this.pwa.session.apiInfo.scene7RootUrl + regItems.prodImg,
          ],
          product_id: [regItems.prodId],
          product_name: [regItems.title],
          product_price: [regItems.price.replace("$", "")],
          product_sku_id: [regItems.skuId],
          skuName: [regItems.title],
          product_url: [skuDet.PDP_URL],
          registrants_name: [
            `${reg.primaryRegistrantFirstName} ${reg.primaryRegistrantLastName}`,
          ],
          registry_add_location: ["PDP"],
          // registry_checklist_completion: [],
          registry_event_date: [
            this.registryCta.data.data.activeRegistry.eventDate,
          ],
          registry_id: [regItems.registryId],
          registry_purchased: [
            this.registryCta.data.data.activeRegistry.giftPurchased,
          ],
          registry_total_items: [
            this.registryCta.data.data.activeRegistry.giftRegistered,
          ],
          registry_type: [this.registryCta.data.data.activeRegistry.eventType],
          // shower_celebration_date: [],
          prodQty: [regItems.qty],
        };
      }
      if (isPLP) {
        const category = $(ampBody).find(".breadcrumbLink span").eq(0).text();
        cta = "plpAddToRegistry";

        beaconData = {
          inventory_status: plpProdDet.storeInventoryStatus_boolean
            ? "in stock"
            : "out of stock",
          // personalization_type: undefined,
          product_category: [category],
          product_has_personalization: [
            plpProdDet.CUSTOMIZATION_OFFERED_FLAG_boolean,
          ],
          product_image_name: [regItems.title],
          product_image_url: [
            this.pwa.session.apiInfo.scene7RootUrl + regItems.prodImg,
          ],
          product_id: [regItems.prodId],
          product_name: [regItems.title],
          product_price: [regItems.price.replace("$", "")],
          product_sku_id: [regItems.skuId],
          skuName: [regItems.title],
          product_url: [plpProdDet.url],
          registrants_name: [
            `${reg.primaryRegistrantFirstName} ${reg.primaryRegistrantLastName}`,
          ],
          registry_add_location: ["PLP"],
          // registry_checklist_completion: [],
          registry_event_date: [
            this.registryCta.data.data.activeRegistry.eventDate,
          ],
          registry_id: [regItems.registryId],
          registry_purchased: [
            this.registryCta.data.data.activeRegistry.giftPurchased,
          ],
          registry_total_items: [
            this.registryCta.data.data.activeRegistry.giftRegistered,
          ],
          registry_type: [this.registryCta.data.data.activeRegistry.eventType],
          // shower_celebration_date: [],
          prodQty: [regItems.qty],
        };
      }

      const ltlShipParams = await this.pwa.analytics.getLtlData({
        prodId: regItems.prodId,
        skuId: regItems.skuId,
      });
      Object.assign(beaconData, ltlShipParams);

      clone
        .attr("data-cta", cta)
        .attr("data-attribute", JSON.stringify(beaconData));
      this.pwa.site.tealiumClickEventEmitter(clone[0], beaconData);
    } catch (err) {
      console.log("error sending add to registry beacon:", err);
    }
  }

  /**
   * Click handler for pdp registry list cta
   * @param {CashJsCollection} ampDoc$ - AMP document
   * @returns undefined
   */
  async registryListClick(regIdStr, target$) {
    // add to registry function
    this.registryItemAddedModalRender(regIdStr, target$);
    this.registrySendCtaBeacon(regIdStr, target$);
    //close menu
    this.registryCtaMenuRender(target$);
  }

  /**
   * Click handler for pdp collection registry list cta
   * @param {String} regIdStr - Registry Id
   * @param {CashJs Object} target$ - clicked node
   * @returns undefined
   */
  async createCollectionRegObj(regIdStr, target$) {
    try {
      let regItemResults = [];
      const regForm = target$.closest("form");
      const regFormData = this.pwa.util.formToObject(regForm).products;
      const pdpDet = await this.pwa.pdpDataAbstraction.getPDPState("pdpDet");
      let reg = this.registryCta.data.data.registryList.filter((reg) => {
        return reg.registryId == regIdStr;
      })[0];
      const regConfig = {
        registryId: regIdStr,
        parentProdId: pdpDet.data.PRODUCT_DETAILS.PARENT_PROD_INFO
          ? pdpDet.data.PRODUCT_DETAILS.PARENT_PROD_INFO[0].PRODUCT_ID
          : pdpDet.data.PRODUCT_DETAILS.PRODUCT_ID,
        registryName: reg ? reg.eventType : "",
        title: pdpDet.data.PRODUCT_DETAILS.DISPLAY_NAME,
        prodImg:
          pdpDet.data.PRODUCT_DETAILS.PRODUCT_IMG_ARRAY[0].imageId || null,
        personalizeImg:
          pdpDet.data.PRODUCT_DETAILS.PRODUCT_IMG_ARRAY[0].personalizeUrlSm ||
          null,
      };
      let regProdData = JSON.parse(
        decodeURIComponent(regFormData).replace(/},]/i, "}]")
      );
      regProdData.forEach((item) => {
        if (item.qty && item.skuId && item.qty !== "0") {
          regItemResults.push(
            Object.assign({}, regConfig, {
              skuId: item.skuId,
              prodId: item.prodId,
              qty: item.qty,
            })
          );
        }
      });
      return regItemResults;
    } catch (e) {
      console.warn(
        `Error building pdp collection registration object. Error: ${e}`
      );
    }
    return [];
  }

  /**
   * Click handler for pdp registry list cta
   * @param {String} regIdStr - Registry Id
   * @param {CashJsCollection} target$ - registryCta element, will be undefined from param routing
   * @returns undefined
   */
  async createPdpRegObj(regIdStr, target$) {
    try {
      // Let's check if it is a collection here, and do not call these data methods if it is a collection
      // there is an interaction param for when the user is logged out and target will be undefined
      if (target$.length && target$.closest("form").hasClass("addToRegC")) {
        return this.createCollectionRegObj(regIdStr, target$);
      } else {
        const skuDet = await this.pwa.pdpDataAbstraction.getSkuDetails();
        const pdpDet = await this.pwa.pdpDataAbstraction.getPDPState("pdpDet");
        const skuFacet = await this.pwa.pdpDataAbstraction.getPDPState(
          "skuFacets"
        );
        let reg = this.registryCta.data.data.registryList.filter((reg) => {
          return reg.registryId == regIdStr;
        })[0];
        let regObj = {
          qty: skuFacet.qty || 1,
          registryId: regIdStr,
          skuId: skuDet.SKU_ID,
          prodId: pdpDet.data.PRODUCT_DETAILS.PRODUCT_ID,
          price: skuDet.IS_PRICE,
          parentProdId: pdpDet.data.PRODUCT_DETAILS.PARENT_PROD_INFO
            ? pdpDet.data.PRODUCT_DETAILS.PARENT_PROD_INFO[0].PRODUCT_ID
            : pdpDet.data.PRODUCT_DETAILS.PRODUCT_ID,
          registryName: reg ? reg.eventType : "",
          title: skuDet.DISPLAY_NAME,
          prodImg: skuDet.PRODUCT_IMG_ARRAY[0].imageId || null,
          personalizeImg: skuDet.PRODUCT_IMG_ARRAY[0].personalizeUrlSm || null,
        };
        return [regObj];
      }
    } catch (e) {
      console.warn(`Error building pdp registration object. Error: ${e}`);
    }
    return [];
  }

  /**
   * Click handler for plp registry list cta
   * @param {String} regIdStr - Registry Id
   * @param {CashJsCollection} target$ - registryCta element, will be undefined from param routing
   * @returns undefined
   */
  async createPlpRegObj(regIdStr, target$) {
    try {
      /*
        I was planning on putting the data in a JSON string on an attribute,
        but since we have to scrape data for the backfill, just decided to keep dom small
        and get data this way.

      */
      let reg = this.registryCta.data.data.registryList.filter((reg) => {
        return reg.registryId == regIdStr;
      })[0];
      let regObj = {
        registryId: regIdStr,
        registryName: reg ? reg.eventType : "",
      };
      const itemDataStr = target$
        .closest(".registryCtaCont")
        .attr("data-prod-reg");
      if (!itemDataStr)
        throw new Error(
          `Unable to get data to add item to registry. Error: ${e}`
        );
      regObj = Object.assign(regObj, JSON.parse(itemDataStr));
      return [regObj];
    } catch (e) {
      console.warn(`Error building pdp registration object. Error: ${e}`);
    }
    return [];
  }

  /**
   * Reserve space for registry components before document is attached to the DOM
   * @param {CashJsCollection} ampDoc$ - AMP document
   * @returns undefined
   */
  async registryCtaMenuRender(btn$, forceOpen) {
    function closeList(btn$) {
      btn$.closest(".registryCtaCont").find("svg").removeClass("deg180");
      btn$.closest(".registryCtaCont").find(".registryList").remove();
      btn$.closest("amp-list").removeClass("overflow");
    }
    // May not need to remove/render this on every click, but not sure how often registries get updated
    let regCont = btn$.parent();
    let shouldOpen = regCont.find(".registryList").length == 0;
    let regOpen = btn$.closest("amp-list").find(".registryList");
    regOpen.each((i, e) => {
      closeList($(e));
    });
    if (shouldOpen || forceOpen) {
      if (this.ownRecommended.data.recommendedRegistryList) {
        this.registryCta.data.data.friendsList =
          this.ownRecommended.data.recommendedRegistryList;
        const isPDP = this.pwa.session.docTests.isPDPReg.test(
          location.pathname
        );
        if (isPDP) {
          let skuId = (await this.pwa.pdpDataAbstraction.getSkuDetails())
            .SKU_ID;
          this.registryCta.data.isPersonalized = this.pwa.personalize
            .personalizedSku[skuId]
            ? true
            : false;
        }
      }

      // add details for create registry link if user doesnt have registry but can recommend products to friends/family
      if (
        this.registryCta.data.data.friendsList &&
        this.registryCta.data.data.friendsList.length &&
        !this.registryCta.data.data.registryList
      ) {
        let prodItem = await this.registryFriendListCreateProdObj(btn$);
        Object.assign(this.registryCta.data, {
          skuId: prodItem.skuId,
          prodId: prodItem.prodId,
          registryType: this.pwa.session.isBABY ? "BABY" : "BRD",
          hrefAsParamRegistry: encodeURIComponent(location.href),
        });
      }
      this.registryCta.data.positionBelow = this.aboveVertCenter(btn$);
      let regList = Mustache.render(
        this.registryCta.template,
        this.registryCta.data
      );
      btn$.closest("amp-list").addClass("overflow");
      regCont.append(regList);
      btn$.find("svg").addClass("deg180");
    }
  }

  /**
   *
   * @param {CashJs Collection} ampDoc$
   * @param {URL} urlObj
   */
  registryCtaBeforeRender(ampDoc$, urlObj) {
    if (this.pwa.session.docTests.isPDPReg.test(urlObj.pathname)) {
      this.backfillCta = false;
      let fulfillList = ampDoc$.find(".prodFulfillmentList2,[data-multi-prod]");
      // prevent showing registry cta on marketplace items
      if (fulfillList.is(".marketplaceCtaCont")) return;

      // Add class that will show registry cta button
      fulfillList.addClass("activeRegistryCta");

      // Reserve space in amp-list for CTA button
      try {
        if (fulfillList.attr("data-init-height")) {
          const heights = {
            0: 125,
            768: 125,
            1024: 0,
            1280: 0,
            1344: 0,
          };
          let htObj = JSON.parse(fulfillList.attr("data-init-height"));
          Object.keys(htObj).forEach((key) => {
            htObj[key] = `${
              parseInt(htObj[key].replace("px", "")) + heights[key]
            }px`;
          });
          fulfillList.attr("data-init-height", JSON.stringify(htObj));
          let ht = parseInt(fulfillList.attr("height").replace("px", "")) + 58;
          fulfillList.attr("height", `${ht}px`);
        }
        // Determine if there is more than one registry to display
        if (
          (this.ownRecommended &&
            this.ownRecommended.data.recommendedRegistryList &&
            this.ownRecommended.data.recommendedRegistryList.length) ||
          (this.registryCta.data &&
            this.registryCta.data.data.registryList &&
            this.registryCta.data.data.registryList.length > 1)
        ) {
          fulfillList.addClass("registrySelect");
        } else {
          fulfillList.removeClass("registrySelect");
        }

        /*
          Check to see if we need to backfill the registry
          Old amp doc that doesn't have the dom elements for registry CTA)
        */
        this.backfillPdpCta(ampDoc$);
      } catch (e) {
        console.warn(
          `Unable to update prodFulfillmentList2 height for registry. Error: ${e}`
        );
      }
    } else if (this.pwa.session.docTests.isPLPReg.test(urlObj.pathname)) {
      try {
        const plpList = ampDoc$.find("#plpListInner,.expertPicksCard");
        plpList.addClass("activeRegistryCta");

        // Check if data is already available (second load)
        if (
          (this.ownRecommended.data.recommendedRegistryList &&
            this.ownRecommended.data.recommendedRegistryList.length) ||
          (this.registryCta.data &&
            this.registryCta.data.data.registryList &&
            this.registryCta.data.data.registryList.length > 1)
        ) {
          plpList.addClass("registrySelect");
        } else {
          plpList.removeClass("registrySelect");
        }
        this.backfillPlpCta(ampDoc$);
      } catch (e) {
        console.warn(
          `Unable to reserve space for PLP registry CTA. Error: ${e}`
        );
      }
    }

    // if load failed on apphsell, try again on each amp load
    if (this.ctaRenderError) this.getRegCtaData(ampDoc$);
  }

  /**
   *
   * @param {Object} urlObj - url being loaded
   * @param {CahsJs Collection} ampBody$ - Cash js collection of current ampBody
   * This function is run after the data used to render the ctas has been loaded.
   * It adds a class to show dropdown array if data is loaded correctly,
   * if data isn't loaded correctly, it hides the buttons.
   */
  registryCtaInitRender(urlObj, ampBody$) {
    if (
      !this.isRegistryPage(urlObj) ||
      !(
        this.pwa.session.docObjActive &&
        this.pwa.session.docObjActive.shadowBody
      )
    )
      return;
    const listSelect = this.pwa.session.docTests.isPDPReg.test(urlObj.pathname)
      ? ".prodFulfillmentList2,[data-multi-prod]"
      : "#plpListInner,.expertPicksCard";
    try {
      if (
        this.pwa.session.docObjActive &&
        this.pwa.session.docObjActive.href == location.href
      ) {
        /*
          Since this is async function that we are not waiting for
          We need to check and see if the document has already been mounted
          If it has, update ampBody$ with active doc
        */
        ampBody$ = $(this.pwa.session.docObjActive.shadowBody);
      }
      // Check that we have data. If for some reason we do not, we hide the registry button
      if (!ampBody$ || !this.registryCta.data.data)
        throw new Error({ message: "No data to render registry." });

      // Determine if there is more than one registry to display
      let list$ = ampBody$.find(listSelect);
      // prevent showing registry cta on marketplace items
      if (list$.is(".marketplaceCtaCont")) return;
      list$.addClass("activeRegistryCta");
      if (
        this.ownRecommended.data.recommendedRegistryList.length ||
        this.registryCta.data.data.registryList.length > 1
      ) {
        list$.addClass("registrySelect");
      } else {
        list$.removeClass("registrySelect");
      }
      this.ctaRenderError = false;

      // handle addToRegistry from url parameter
      let url = new URL(urlObj.href);
      if (url.searchParams.has("addToRegistry")) {
        this.registryParamRouter(ampBody$, url);
        url.searchParams.delete("addToRegistry");
        history.replaceState("", document.title, url.toString());
      }
    } catch (e) {
      // If we do not have data, hide the registry CTA
      this.ctaRenderError = true;
      ampBody$.find(listSelect).removeClass("activeRegistryCta");
    }
  }

  // removes the overlay and footer panels, called from ampbody click handler and on click of overlay
  closeRegistryFooterPanel() {
    $(".registryOverlay").removeClass("active");
    $(".registryFooterPanel").addClass("wHide");
    $(".registryFooterActive").removeClass(
      "registryFooterActiveBefore registryFooterActive"
    );
    $("body").removeClass("modalOpen");
  }

  // set this.registryTypeId based on concept and registryType
  findRegistryTypeId(registryType) {
    if (this.pwa.session.isCANADA) {
      this.registryTypeId = this.caRegistryTypeIds[registryType];
    } else {
      this.registryTypeId = this.registryTypeIds[registryType];
    }
  }

  // create links for registry footers based on react urls, since this is not included in the API response
  // TODO: find all possible links and add them to this.registryLinks and refresh this.registryLinks every time the registry changes
  modifyRegistryLinks(data) {
    let excluded = ["Registry", "Checklist", "Build", "More"];
    for (const el of data) {
      if (el.bannerLink && el.bannerLink.includes("/")) {
        el.url = `/store/${el.bannerLink}`;
      } else if (!excluded.includes(el.bannerText)) {
        el.url = `${this.registryLinks[el.bannerLink]}${
          el.requestParams ? `?${el.requestParams}` : ""
        }`;
      }
      // make sure book an appointment has correct params
      if (
        el.bannerText == "Book an Appointment" &&
        !/&action|\?action/.test(el.url)
      ) {
        if (/\?/.test(el.url)) el.url += "&action=appointment";
        else el.url += "?action=appointment";
      }
    }
  }

  /**
   * Handle transition between desktop/non-desktop viewport widths
   * @param {CashJsCollection} ampBody$ - AMP body
   * @returns undefined
   */
  onResizeEnd(ampBody$) {
    if (!this.pwa.user.hasRegistry) return;
    // TODO - handle resize event before init() is complete for footer data.
    this.registryAllRender(ampBody$, location);

    // add or remove room for the footer element on resize
    if (window.innerWidth >= 1024)
      ampBody$.find("#wm_footer").removeClass("hasRegistryFooter");
    else ampBody$.find("#wm_footer").addClass("hasRegistryFooter");

    //hides the checklist if it is open, could add the correct classes to the dskChecklistBtn instead
    ampBody$.find(".registrySidebar").removeClass("registrySidebarShow");
    $("body").removeClass("modalOpen");
    let checklistBtn = ampBody$.find(".dskChecklistBtn");
    checklistBtn.removeClass("dskChecklistBtnActive");
    checklistBtn.attr("data-modal-open", true);
    ampBody$.find(".sidebarOverlay").removeClass("active");
  }

  /**
   * Get data, then initial render on first page load.
   * Intended to be called once.
   * @returns undefined
   */
  async init() {
    if (
      !this.pwa.user.hasRegistry ||
      !this.pwa.session.registryAssetsPrefetch
    ) {
      this.registryFriendListCtaRender();
      return;
    }
    try {
      // Wait for all the AJAX, scripts, and DOM to be available
      let registryAssetsAndRequirements = await Promise.all(
        this.pwa.session.registryAssetsPrefetch.concat([
          this.pwa.util.waitForProp("Mustache"),
          this.pwa.util.waitForProp("docObjActive", this.pwa.session),
        ])
      );
      let [template$, allRegistriesData, ownRecommended, stickyFooterData] =
        await Promise.all(
          registryAssetsAndRequirements.map(
            async function (asset) {
              if (!asset.type) return;

              if (asset.type == "json") return await asset.res.json();
              else if (asset.type == "html") {
                return $(await asset.res.text());
              }
            }.bind(this)
          )
        );
      // in case of old appshell with new pwamp can be removed after 2.16
      // if (
      //   ownRecommended &&
      //   ownRecommended.data &&
      //   ownRecommended.data.stickyFooterResponse
      // ) {
      //   stickyFooterData = ownRecommended;
      //   ownRecommended = {
      //     data: {
      //       recommendedRegistryList: [],
      //     },
      //   };
      // } else if (ownRecommended == undefined) {
      //   ownRecommended = {
      //     data: {
      //       recommendedRegistryList: [],
      //     },
      //   };
      // }

      this.registryNav = {
        data: allRegistriesData,
        template: template$.find("#registryNav").html() || "",
      };
      this.registryFooter = {
        // may be undefined if tablet or above (not fetched in appshell)
        data: stickyFooterData,
        template: template$.find("#registryFooter").html() || "",
      };
      this.registrySidebar = {
        // data Fetched when necessary for mobile, on load for tablet and above
        template: template$.find("#registrySidebar").html() || "",
      };
      this.registryItemAddedModal = {
        template: template$.find("#registryItemAddedModal").html() || "",
      };
      this.registryStoreFinderModal = {
        template: template$.find("#registryStoreFinderModal").html() || "",
      };
      this.registryCta = {
        data: this.registryNav.data,
        template: template$.find("#registryCta").html() || "",
      };
      this.activeRegistry =
        this.registryNav.data.data.activeRegistry.registryId;
      this.ownRecommended = {
        data: ownRecommended.data || {},
        template: template$.find("#registryFriendRecModal").html() || "",
      };

      // Render
      this.registryAllRender(
        $(this.pwa.session.docObjActive.shadowBody),
        location
      );
    } catch (e) {
      console.error(`Error getting registry data. Error: ${e}`);
    }
    // we are awaiting this docObjActive above, but if the one of the calls fails...
    if (!this.pwa.session.docObjActive)
      await this.pwa.util.waitForProp("docObjActive", this.pwa.session);

    this.registryCtaInitRender(
      location,
      this.pwa.session.docObjActive
        ? $(this.pwa.session.docObjActive.shadowBody)
        : undefined
    );
  }

  /**
   * Returns whether Registry components should be rendered on the page.
   * @param {URL} urlObj - url object for the page
   * @returns boolean
   */
  isRegistryPage(urlObj) {
    return (
      (this.pwa.session.docTests.isPDPReg.test(urlObj.pathname) ||
        this.pwa.session.docTests.isPLPReg.test(urlObj.pathname)) &&
      !this.pwa.session.docTests.isCLPReg.test(urlObj.pathname)
    );
  }

  /**
   * Render registry components in footer, nav, and sidebar
   * @param {CashJsCollection} ampBody$ - AMP body
   * @returns undefined
   */
  async registryAllRender(ampBody$, urlObj) {
    if (!this.pwa.user.hasRegistry) return;

    // List registries in Nav
    await this.registryNavRender(ampBody$);

    if (this.isRegistryPage(urlObj)) {
      this.registryFooterToggle(true);
    } else {
      this.registryFooterToggle(false);
      return;
    }

    // render registry components after AJAX calls / resize event / user changes active registry
    this.registryFooterRender(ampBody$);

    this.registrySidebarRender(ampBody$);
  }

  /*****************************/
  /*** Mobile footer methods ***/
  /*****************************/

  registryFooterClickHandler(event) {
    let target$ = $(event.currentTarget);

    // added to each of the footer buttons
    if (target$.is("[data-registry-footer]")) {
      try {
        this.registryFooterPanelToggle(target$.attr("data-registry-footer"));
      } catch (e) {
        console.warn(`Error rendering footer panel. Error: ${e}`);
      }
    }

    // added to each registry footer panel button
    if (target$.is("[data-registry-id]")) {
      // this flag is set to reopen the registry panel
      this.registryFooter.reRendered = true;

      this.activeRegistryChange(
        $(this.pwa.session.docObjActive.shadowBody),
        target$.attr("data-registry-id")
      );

      // this makes the transition look smoother
      $(".activeRegistry")
        .removeClass("activeRegistry")
        .find(".changeRegistryLink")
        .addClass("wHide");
      target$
        .addClass("activeRegistry")
        .find(".changeRegistryLink")
        .removeClass("wHide");
    }
  }

  /**
   * Get footer data when user changes viewports or active registry
   */
  async registryFooterDataGet() {
    if (this.registryFooter.data) return this.registryFooter.data;

    // TODO - API call if user loaded desktop viewport but has resized to mobile.
    // otherwise this.registrySidebar.data is prefetched in appshell
    try {
      const regFooterDataFetch = await fetch(
        `${location.origin}/apis/stateful/v1.0/registry/sticky-footer`,
        {
          method: "POST",
          headers: Object.assign(
            {
              accept: "application/json, text/plain, */*",
              "atg-rest-depth": 2,
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );
      this.registryFooter.data = await regFooterDataFetch.json();
    } catch (e) {
      console.warn(`Failed to get data from stick footer API. Error: ${e}`);
    }

    return this.registryFooter.data;
  }

  // modify the data we get from the sticky footer api
  registryFooterDataModify(regData) {
    // find the correct links to display in the footer, max of 5, if they are included in the links section of the API response
    // then append to stickyLinks in the order specified inOrderCheckLinks array, otherwise take the links in order from the stickyLinks section
    let stickyLinks = regData.data.stickyFooterResponse.footer.stickyLinks;
    let links = regData.data.stickyFooterResponse.footer.links;
    let numLinks = 5;
    let outOfOrderLinks = [];
    // need to be added in the order they appear in the footer
    let inOrderCheckLinks = ["Build", "More"];

    for (const el of inOrderCheckLinks) {
      if (links[el]) {
        numLinks--;
        let foundLink = stickyLinks.filter((i) => i.bannerText == el)[0];
        outOfOrderLinks.push(foundLink);
      }
    }

    let newLinks = stickyLinks.slice(0, numLinks);

    if (regData.data.stickyFooterResponse.displayFlags.isCheckListDisabled) {
      newLinks = newLinks.filter((itm) => {
        return itm.bannerText !== "Checklist";
      });
      regData.data.stickyFooterResponse.registryModifyClass = "noChecklist";
    }

    regData.data.stickyFooterResponse.footer.stickyLinks =
      newLinks.concat(outOfOrderLinks);

    // create urls for the required links from the data
    this.activeRegistry =
      regData.data.stickyFooterResponse.registryList.activeRegistryId;
    const registryType = regData.data.stickyFooterResponse.footer.registryType;
    const collegeType = this.pwa.session.isCANADA
      ? "university"
      : "college-university";
    const urlKey = registryType == "HSW" ? "housewarming" : collegeType;

    this.findRegistryTypeId(registryType);
    // this uses the bannerLink property from the API as the property name
    this.registryLinks = {
      "add items": `/store/giftRegistry/viewRegistryOwner/myItems/${this.activeRegistry}`,
      analyzer: `/store/giftRegistry/viewRegistryOwner/myItems/${this.activeRegistry}?action=analyzer`,
      askAFriend: `/store/giftRegistry/viewRegistryOwner/recommendation/${this.activeRegistry}`,
      "ask a friend": `/store/giftRegistry/viewRegistryOwner/recommendation/${this.activeRegistry}`,
      browseAndGifts: `/store/kickstarters/${urlKey}/${this.registryTypeId}`,
      checkListForm: "/store/giftregistry/customisedChecklistForm",
      collegeCheckListHome: "/store/checklist/viewListOwner/home",
      collegeCheckListMyItems: `/store/checklist/viewListOwner/myItems/${this.activeRegistry}?schoolId`,
      "featured products": "/store/quickpicks",
      flipFlop: `/store/giftregistry/flipFlop/${registryType}/${this.activeRegistry}`,
      genericCollegeLanding: "/store/page/college",
      getThankyouLandingPage: `/store/giftRegistry/viewRegistryOwner/tym/${this.activeRegistry}`,
      kickstarters: "/store/kickstarters",
      listOwner: `/store/checklist/viewListOwner/myItems/${this.activeRegistry}`,
      "manage registry": `/store/giftRegistry/viewRegistryOwner/myItems/${this.activeRegistry}`,
      moversListOwner: `/store/checklist/viewMoversListOwner/myItems/${this.activeRegistry}`,
      myregistries: "/store/account/my_registries",
      "my account": "/store/account/my_registries",
      quickPicks: "/store/quickpicks",
      "quick picks": "/store/quickpicks",
      pnhListOwner: `/store/checklist/viewPNHListOwner/shopItems/${this.activeRegistry}`,
      pnhManageListOwner: `/store/checklist/viewPNHListOwner/manageItems/${this.activeRegistry}`,
      registry: "/store/account/my_registries",
      registryOwner: `/store/giftRegistry/viewRegistryOwner/myItems/${this.activeRegistry}`,
      registryOwnerHome: `/store/giftRegistry/viewRegistryOwner/home/${this.activeRegistry}`,
      "share registry": `/store/giftRegistry/viewRegistryOwner/myItems/${this.activeRegistry}?action=share`,
      shoppingList: "/store/account/shoppingList",
      "shop this look": "/store/quickpicks",
      "static/content/movers": "/store/static/movers",
      "thank you list": `/store/giftRegistry/viewRegistryOwner/tym/${this.activeRegistry}`,
      viewList: `/store/checklist/viewListOwner/myItems/${this.activeRegistry}`,
      viewRegistry: `/store/giftRegistry/viewRegistryOwner/myItems/${this.activeRegistry}`,
    };

    this.modifyRegistryLinks(
      regData.data.stickyFooterResponse.footer.stickyLinks
    );

    Object.values(regData.data.stickyFooterResponse.footer.links).forEach(
      (prop) => this.modifyRegistryLinks(prop)
    );
  }

  /**
   * Renders registry footer 1x on appshell and only update when user changes registry
   * @param {CashJsCollection} ampBody$ - AMP body
   * @returns {Promise} - resolves to undefined
   */
  async registryFooterRender(ampBody$) {
    // this.registryFooter.rendered can be set to false in this.activeRegistryChange;
    if (
      window.innerWidth >= 1024 ||
      this.registryFooter.rendered ||
      !this.registryFooter.template
    )
      return;

    const registryFooter = this.registryFooter;
    registryFooter.data = await this.registryFooterDataGet();

    // modify footer data
    try {
      this.registryFooterDataModify(registryFooter.data);
      // prevent footer from rendering without data
      if (
        !registryFooter.data.data.stickyFooterResponse.footer.stickyLinks.length
      )
        return;
    } catch (e) {
      console.warn(`Error modifying footer data. Error: ${e}`);
      return;
    }

    registryFooter.dom =
      registryFooter.dom ||
      $("body")
        .append(
          `<div data-wm="appshell" id="registryFooter" class="${
            this.pwa.session.isBABY ? "babyFooter" : ""
          }"></div>`
        )
        .find("#registryFooter");

    const footerDomHtml = Mustache.render(
      registryFooter.template,
      registryFooter.data
    );

    registryFooter.dom.html(footerDomHtml);
    registryFooter.rendered = true;

    // remove unused href
    $("a.registryRemoveLink").removeAttr("href");

    // click events for footer
    $(".registryFooterItem").on("click", this.registryFooterClickHandler);
    $(".registryOverlay").on("click", this.closeRegistryFooterPanel);

    // readd classes if the active registry has changed
    if (this.registryFooter.reRendered) {
      $(".registryOverlay").addClass("active");
      $(".registryFooterPanel").removeClass("wHide");
      $("[data-registry-footer='Registry']").addClass(
        "registryFooterActive registryFooterActiveBefore"
      );
      this.registryFooter.reRendered = false;
    }
  }

  // renders all links for the registries panel as part of footer and sidebar
  registryPanelListTemplate(regData, panelClass, viewBoxMod) {
    let sidebar = panelClass === "registrySidebarPanel";
    let registryPanel = /*html*/ `<div class=${panelClass}>
        <div class="vb15 regBorderBtm sidebarRegistryList">
          <div class="vb15 registryPanelHead">Registries</div>
          ${regData
            .map((reg) => {
              return /*html*/ `<div class="vb15 ${
                reg.registryId == this.activeRegistry
                  ? "activeRegistry"
                  : "pointer"
              }" data-registry-id="${reg.registryId}" ${
                sidebar
                  ? `data-click-handler="registry.registrySideBarClickHandler(${reg.registryId})" data-modal-close`
                  : ""
              }>
                    <div class="noTap">
                      ${reg.primaryRegistrantFirstName}${
                reg.coRegistrantFirstName
                  ? ` & ${reg.coRegistrantFirstName}`
                  : ""
              }'s ${reg.eventType}
                    </div>
                    <a href=${`/store/giftRegistry/viewRegistryOwner/myItems/${reg.registryId}`} class="pointer changeRegistryLink ${
                reg.registryId == this.activeRegistry ? "" : "wHide"
              }">
                      See Dashboard
                      <svg class="regArrow" xmlns="http://www.w3.org/2000/svg" height="18px" width="18px" viewBox="${viewBoxMod}">
                        <path fill="none" stroke="currentColor" stroke-linecap="square" stroke-width="2" d="M1 6h18m-3-4l4 4m-4 4l4-4"></path>
                      </svg>
                    </a>
                </div>`;
            })
            .join("")}
        </div>
      </div>`;

    return registryPanel;
  }

  // renders all links in footer panels that are not in the registry panel
  registryFooterLinkPanelTemplate(tabName) {
    let registryPanel = /*html*/ `<div class="registryFooterPanel">
      ${this.registryFooter.data.data.stickyFooterResponse.footer.links[tabName]
        .map((reg) => {
          return /*html*/ `<div class="vb15">
              <a class="registryFooterLink" href="${reg.url}">
                ${reg.bannerText}
              </a>
            </div>`;
        })
        .join("")}
      </div>`;

    return registryPanel;
  }

  /**
   * Hides or show a registry footer tab
   * @param {String} tabName - Name of registry footer tab to show/hide
   * @returns undefined
   */
  async registryFooterPanelToggle(tabName) {
    let target = $(`[data-registry-footer="${tabName}"]`);
    let ampBody$ = $(this.pwa.session.docObjActive.shadowBody);
    // only remove overlay if user clicks on the same button twice or on body handled in footer init
    let overlay = $(".registryOverlay");
    let panel = $(".registryFooterPanel");
    if (target.hasClass("registryFooterActive") && overlay.hasClass("active")) {
      target.removeClass("registryFooterActiveBefore");
      overlay.removeClass("active");
      $("body").removeClass("modalOpen");
      panel.remove();
      return;
    } else if (target.find(".registryRemoveLink").length) {
      // make the overlay visible
      overlay.addClass("active");
      $("body").addClass("modalOpen");
      // adjust overlay if the pencil banner is hidden
      if (ampBody$.hasClass("hidePencil")) {
        let height = ampBody$.find(".pencilBannerAL").height() - 5;
        overlay.css("top", `calc(var(--headHeight) - ${height}px)`);
      } else {
        overlay.css("top", `calc(var(--headHeight) + 5px)`);
      }
    } else {
      // if neither of the above happens then it is a link and the rest doesn't need to happen
      return;
    }
    // change which footer button is the active one
    $(".registryFooterActive").removeClass(
      "registryFooterActive registryFooterActiveBefore"
    );
    target.addClass("registryFooterActive registryFooterActiveBefore");

    // specific actions per which footer button was clicked
    let content = "";
    if (tabName == "Registry") {
      content = this.registryPanelListTemplate(
        this.registryFooter.data.data.stickyFooterResponse.registryList
          .profileRegistryList,
        "registryFooterPanel",
        "0 0 21 6"
      );
    } else if (tabName == "Checklist") {
      // show checklist
      $(".registryFooterActive").removeClass(
        "registryFooterActive registryFooterActiveBefore"
      );
      overlay.removeClass("active");
      panel.remove();

      // show checklist if flag is true else show checklist toggle modal
      let allRegData = await this.registryNavDataGet();
      if (allRegData.data && allRegData.data.activeRegistry.showChecklist) {
        if (ampBody$.find(".registrySidebar").length)
          ampBody$.find(".registrySidebar").addClass("registrySidebarShow");
        else {
          // was never rendered and needs to be rendered now
          await this.registrySidebarRender(ampBody$);
          ampBody$.find(".registrySidebar").addClass("registrySidebarShow");
        }
      } else {
        this.checkListToggleModalRender(ampBody$);
      }
    } else {
      content = this.registryFooterLinkPanelTemplate(tabName);
    }

    // update panel content or create the panel if it doesnt exist
    if (content) {
      if (panel.length) {
        panel.replaceWith(content);
      } else {
        $(content).insertAfter($("#registryFooter"));
      }
    }

    // add event listener to registry buttons if they exist
    $("[data-registry-id]").on("click", this.registryFooterClickHandler);
  }

  /**
   * Show or hide th registry footer.
   * @param {boolean} (opt) showOrHide -force toggle override
   */
  registryFooterToggle(showOrHide) {
    const footerDom = this.registryFooter.dom;
    if (!footerDom) return;

    if (showOrHide == true) footerDom.removeClass("wHide");
    else if (showOrHide == false) footerDom.addClass("wHide");
  }

  /**
   * creates prod object for friends list recommendation
   * @param {CashJsCollection} btn$ - element in registryCtaCont that was clicked
   */
  async registryFriendListCreateProdObj(btn$) {
    const isPDP = this.pwa.session.docTests.isPDPReg.test(location.pathname);
    let prodItem = {};
    try {
      if (isPDP) {
        const skuDet = await this.pwa.pdpDataAbstraction.getSkuDetails();
        const pdpDet = await this.pwa.pdpDataAbstraction.getPDPState("pdpDet");
        prodItem = {
          skuId: skuDet.SKU_ID,
          prodId: pdpDet.data.PRODUCT_DETAILS.PRODUCT_ID,
          title: skuDet.DISPLAY_NAME,
          prodImg: skuDet.PRODUCT_IMG_ARRAY[0].imageId || null,
        };
      } else {
        prodItem = JSON.parse(
          btn$.closest(".registryCtaCont").attr("data-prod-reg")
        );
      }
    } catch (e) {
      console.warn(
        `Registry: registryFriendListCreateProdObj, couldnt get product information Error: ${e}`
      );
    }
    return prodItem;
  }

  // click handler for input btn in registry friends list modal
  // hides btn and shows input bar if val is 10
  registryFriendListInputBtnClick(argStr, target$) {
    let modal = target$.closest(".registryFriendRecModal");
    let qty = modal.find("#quantity");
    let val = target$.attr("data-value");
    let friendQtBtn = modal.find(".registryFriendQtBtn");
    if (val == "10") {
      friendQtBtn.addClass("wHide");
      qty.parent().removeClass("wHide");
      qty[0].focus();
    }
    friendQtBtn.removeClass("active");
    friendQtBtn[0].focus();
    qty.val(val);
    modal.find(".registryFriendQt").text(val);
    target$.parent().find(".registryFriendBtn.active").removeClass("active");
    target$.addClass("active");
    this.closeModal("false", target$);
  }

  // click handler for click on friends registry option in registry list
  // constructs data needed for api call and renders the modal
  async registryFriendListClick(regId, target$) {
    let regItem = await this.registryFriendListCreateProdObj(target$);
    let data = {
      regId,
      origin: location.origin,
      imgBase: this.pwa.session.apiInfo.scene7RootUrl,
      isBaby: this.pwa.session.isBABY,
    };
    Object.assign(data, regItem);
    // sets btn to text of friend registry, will include if they think its necessary
    // let regCta = target$.closest(".registryCtaCont").find(".registryCta");
    // regCta.html(
    //   regCta.html().replace(/Add to Registry/, target$.text().trim())
    // );
    const friendRecHtml = Mustache.render(this.ownRecommended.template, data);
    let body$ = target$.closest("body");
    body$
      .append(friendRecHtml)
      .find("#registryFriendComment")
      .on("input", this.registryFriendModalClick);
    body$.find(".registryFriendRecModal")[0].focus();
    body$
      .find(".registryFriendQuantity")
      .on("input", this.registryFriendListQtChange);
    this.registryCtaMenuRender(target$);
  }

  /**
   * Show the registry CTAs if the user has been asked to recommend products to their friend's/family's registry
   * run when a user has been asked but does not have any registries themselves
   */
  async registryFriendListCtaRender() {
    // if not logged in user or Harmon, return
    if (!this.pwa.user.hasAcct || this.pwa.session.isHARMON) return;
    //pwaSessionInit.apiInfo.registryTemplates
    let ATG_PROFILE_DATA = this.pwa.util.cookieGet("ATG_PROFILE_DATA");
    let ownRecommended = await this.pwa.util.statefulFetch(
      `${location.origin}/apis/stateful/v1.0/customers/${ATG_PROFILE_DATA}/registry/own-recommended`,
      {
        credentials: "include",
        method: "GET",
        headers: await this.pwa.user.sessionConfirmationHeadersGetOrSet(),
      }
    );

    // if the user does not have recommended registries either, return
    if (
      !(
        ownRecommended.data &&
        ownRecommended.data.recommendedRegistryList &&
        ownRecommended.data.recommendedRegistryList.length
      )
    ) {
      return;
    }
    // fetch registry templates and create necessary registry objects
    let registryTemplatesFetch = await fetch(
      `${location.origin}${this.pwa.session.apiInfo.registryTemplates}`,
      {
        method: "GET",
      }
    );
    let registryTemplates = $(await registryTemplatesFetch.text());

    // need to provide empty data for cta to show the create registry item for people without their own registry
    this.registryCta = {
      data: { data: [] },
      template: registryTemplates.find("#registryCta").html() || "",
    };
    this.ownRecommended = {
      data: ownRecommended.data || {},
      template: registryTemplates.find("#registryFriendRecModal").html() || "",
    };

    // need mustache and docObjActive to be available before we load the ctas
    await Promise.all([
      this.pwa.util.scriptAddMustache(),
      this.pwa.util.waitForProp("docObjActive", this.pwa.session),
      this.pwa.util.waitForProp("Mustache"),
    ]);

    // show CTAs
    this.registryCtaInitRender(
      location,
      this.pwa.session.docObjActive
        ? $(this.pwa.session.docObjActive.shadowBody)
        : undefined
    );
  }

  // click handler for when user clicks on the friend modal itself
  // will change the input back to the quantity btn and closes the quantity modal if open
  registryFriendModalClick(argStr, target$) {
    // this should only happen on input of textarea to close the quantity modal
    if (argStr) {
      target$ = $(argStr.target).closest(".modal");
    }
    let modal = target$;
    let qty = modal.find(".registryFriendQuantity");
    if (qty.val() < 10) {
      let val = qty.val() > 0 ? qty.val() : 1;
      qty.val(val);
      qty.parent().addClass("wHide");
      modal.find(".registryFriendQtBtn").removeClass("wHide");
      modal.find(".registryFriendQt").text(val);
      let qtModal = modal.find(".registryFriendQtModal");
      qtModal.find(".registryFriendBtn.active").removeClass("active");
      qtModal.find(`[data-value="${val}"]`).addClass("active");
    }
    target$.find(".registryFriendQtBtn").removeClass("active");
    target$.find(".registryFriendQtModal").removeClass("active");
  }

  // input event for quantity input in friends list modal
  // restricts length to two chars, makes sure value is a positive number
  registryFriendListQtChange(event) {
    let target$ = $(event.target);
    let val = target$.val();
    if (val.length > 2) {
      val = val.slice(0, 2);
    }
    target$.val(val.replace("-", ""));
    if (val === "0") {
      target$.val(1);
    }
  }

  // click handler for quantity input btn in friends list modal
  // opens the quanitity modal
  registryFriendListQtClick(argStr, target$) {
    target$.toggleClass("active");
    let modal = target$.closest(".modal");
    let friendModal = modal.find(".registryFriendQtModal");
    friendModal.toggleClass("active");
    if (friendModal.hasClass("active"))
      friendModal.find(".registryFriendBtn.active")[0].focus();
  }

  // click handler for recommend button in friends list modal
  // serializes form and calls recommmend api, then closes the modal
  async registryFriendListRecBtn(argStr, target$) {
    let form = target$.closest("form");
    if (form.find(".registryFriendQuantity").val() == "")
      form.find(".registryFriendQuantity").val("1");
    let formData = form.serialize();
    let data = await this.pwa.util.statefulFetch(
      `${location.origin}/apis/stateful/v1.0/registry/recommend`,
      {
        body: formData,
        credentials: "include",
        method: "POST",
        headers: Object.assign(
          await this.pwa.user.sessionConfirmationHeadersGetOrSet(),
          {
            "atg-rest-depth": "2",
            "Content-Type": "application/x-www-form-urlencoded",
          }
        ),
      }
    );
    //added to tell user of success or failure of api call
    let successModal = this.registryFriendListSuccessTemplate(
      data.serviceStatus
    );
    target$.closest("body").append(successModal);

    this.closeModal("true", target$);
  }

  // Template for success modal, tells user if api call was successful or an error occured
  registryFriendListSuccessTemplate(status) {
    return /*html*/ `
    <div id="modalRegistryFriendSuccess" class="modal active" tabindex="-1">
      <style>
        .regSuccessHead {
          font: 600 24px/1.17 var(--fontMain);
        }
        .babyFriendListSuccess .regSuccessHead {
          font: 500 24px/1.25 var(--fontDisplay);
        }
        .regSuccessMsg {
          font: 300 16px/1.13 var(--fontMain);
        }
        .babyFriendListSuccess .regSuccessMsg {
          font: 300 14px/1.13 var(--fontMain);
        }
        .babyFriendListSuccess .regSuccessRecBtn {
          text-transform: capitalize;
        }
        .friendListError {
          font: var(--menuLight);
          border-radius: 4px;
          border: 2px solid #ffce36;
          background-color: #fffae9;
          height: 50px;
        }
        @media (min-width: 48rem) {
          .regSuccessHead {
            font: 600 28px/normal var(--fontMain);
          }
          .babyFriendListSuccess .regSuccessHead {
            font: 500 28px/1.25 var(--fontDisplay);
          }
          .regSuccessMsg {
            font: 300 16px/1.38 var(--fontMain);
          }
          .babyFriendListSuccess .regSuccessMsg {
            font: 300 14px/1.36 var(--fontMain);
          }
        }
      </style>
      <div class="modalContent flexModal ${
        this.pwa.session.isBABY ? "babyFriendListSuccess" : ""
      }">
        <div class="modalContentInner flex col ctr parent">
          <button class="btn modalClose" data-click-handler="registry.closeModal(true)" data-modal-close aria-label="Close Modal" type="button">
            <svg class="wi wiClose noTap">
              <use xlink:href="#wiClose"></use>
            </svg>
          </button>
          ${
            status == "SUCCESS"
              ? /*html*/ `
              <div class="vb05 regSuccessHead">${
                this.pwa.session.isBABY ? "T" : "t"
              }hanks, your recommendation is sent!</div>
              <div class="vb2 regSuccessMsg">Note: The registrant(s) will review your recommendation</div>
              <button type="button" class="s12 t4 vb1 btn btnLrg btnPrimary regSuccessRecBtn" data-click-handler="registry.closeModal(true)" data-modal-close>recommend again</button>
              <a href="/store/account/my_registries" class="btnLink">skip, return to registry view</a>
            `
              : /*html*/ `<div class="flex midCtr friendListError">We encountered an error sharing your recommendation. Please try again.</div>`
          }
        </div>
      </div>
    </div>
    `;
  }

  /*****************************************/
  /*** "Added to Registry" Modal methods ***/
  /*****************************************/

  /**
   * Adds item(s) to Registry
   * @param {String} registryId
   * @param {Object} items
   * @returns {Promise} resolves to success or error object
   */
  async registryItemsAdd(registryId, items) {
    let atgProfile = this.pwa.util.cookieGet("ATG_PROFILE_DATA");
    let addItemResults = [];
    let regObj = {};
    let json = "";
    let regRespObj = null;
    // submit add cart

    const regConfigParent = {
      addItemResults: [],
      parentProdId: "",
      registryName: "",
      isList: false,
      fromComparisonPage: "",
      returnURL: "",
      skipNotifyFlag: "false",
    };

    const regConfigItem = {
      qty: "1",
      registryId: "",
      skuId: "",
      price: "",
      prodId: "",
      isCustomizationRequired: false,
      refNum: "",
      ltlFlag: "false",
      altNumber: "",
      ltlShipMethod: null,
      porchPayLoadJson: "",
    };

    //Not sure that we will every be adding more than one item, but added this just in case
    try {
      items.forEach((item) => {
        // gets data from personalize array if item has been personalized
        let pData = this.pwa.personalize.personalizedSku[item.skuId];
        addItemResults.push(
          Object.assign({}, regConfigItem, {
            registryId: registryId,
            prodId: item.prodId,
            skuId: item.skuId,
            price: item.price,
            qty: item.qty || "1",
            isCustomizationRequired: pData ? true : false,
            personalizationType: pData ? "PB" : undefined,
            refNum: pData ? pData.refnum : "",
          })
        );
        // removes personalize data from pdp page
        if (pData) this.pwa.personalize.removeData(item.skuId);
      });

      regObj = Object.assign({}, regConfigParent, {
        addItemResults: addItemResults,
        parentProdId: items[0].parentProdId,
        registryName: items[0].registryName,
      });
      json = `jasonCollectionObj=${encodeURIComponent(JSON.stringify(regObj))}`;
    } catch (e) {
      console.warn(`Error creating data for add to registry. Error: ${e}`);
      return {
        error: "Unable to parse data to add to registry. ",
      };
    }

    try {
      regRespObj = await this.pwa.util.statefulFetch(
        `${location.origin}/apis/stateful/v1.0/customers/${atgProfile}/registry/item`,
        {
          body: json,
          credentials: "include",
          method: "POST",
          headers: Object.assign(
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );
      //regRespObj = await regRes.json();
      if (regRespObj.errorMessages)
        throw new Error({
          message: `Problem with add to registry API call. Error: ${regRespObj.errorMessages[0].message}`,
        });
      return regRespObj;
    } catch (e) {
      console.warn(`Add to registry API failed. Error: ${e}`);
      return {
        error:
          "Network error when trying to add to registry. Item was not added. ",
      };
    }
  }

  /**
   *
   * @param {String} objStr - string args object coming from form
   * @param {CashJs Node} ele$ - favorite button
   * @returns
   */
  async regFavClick(objStr, ele$) {
    ele$.addClass("noTap");
    let favObj = ele$.closest("form").serialize();
    try {
      if (ele$.hasClass("active"))
        favObj = favObj.replace(/markAsFav=Y/, "markAsFav=N");

      const favResp = await this.regSendFav(favObj);
      if (favResp.data.result) {
        ele$.closest(".fav").removeClass("panelAlert");
        if (/markAsFav=Y/.test(favObj)) {
          ele$.addClass("active");
        } else {
          ele$.removeClass("active");
        }
      } else {
        throw new Error("Unable to add to add item to favorites");
      }
    } catch (e) {
      console.warn(`Unable to add item to favorites`);
      ele$.closest(".fav").addClass("panelAlert");
    }
    ele$.removeClass("noTap");
    return;
  }

  /**
   *
   * @param {Strong} objStr - JSON string of data to send to api
   */
  async regSendFav(objStr) {
    let regFav = null;
    try {
      regFav = await this.pwa.util.statefulFetch(
        `${location.origin}/apis/stateful/v1.0/registry/mark-item-favorite`,
        {
          body: objStr,
          credentials: "include",
          method: "PUT",
          headers: Object.assign(
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );
      //regFav = await regFavRes.json();
      if (!regFav.data) throw new Error("Unable to add fav");
    } catch (e) {
      console.warn(`Unable to mark item as favorite. Error: ${e}`);
      regFav.error = `Unable to add item as favorite. Error: ${e}`;
    }
    return regFav;
  }

  /**
   * Render "Added to Registry" Modal
   * @param {String} regId
   * @param {String} regItems
   */
  async registryItemAddedModalRender(regId, target$) {
    const regItems = this.pwa.session.docTests.isPDPReg.test(location.pathname)
      ? await this.createPdpRegObj(regId, target$)
      : await this.createPlpRegObj(regId, target$);

    const itemsAddedRes = await this.registryItemsAdd(regId, regItems);
    let ampBody$ = $(this.pwa.session.docObjActive.shadowBody);
    ampBody$[0].registrySidebarRendered = false;
    this.registrySidebar.data = null;
    this.registrySidebarRender(ampBody$);
    try {
      const modalObj = {
        error: itemsAddedRes.error || null,
        items: regItems.length > 1 ? regItems[0] : regItems,
        origin: location.origin,
        imgBase: this.pwa.session.apiInfo.scene7RootUrl,
      };
      try {
        modalObj.rowId =
          itemsAddedRes.data.component.itemDetailsVO &&
          itemsAddedRes.data.component.itemDetailsVO[0].rowId
            ? itemsAddedRes.data.component.itemDetailsVO[0].rowId
            : null;
      } catch (e) {
        modalObj.rowId = null;
      }
      // For multi sku reg calls (collections and accessories)
      if (regItems.length > 1) {
        let totalQty = 0;
        totalQty = regItems.reduce((acc, item) => {
          acc += parseInt(item.qty);
          return acc;
        }, 0);
        modalObj.items.qty = totalQty;
      }
      const modalRendered = Mustache.render(
        this.registryItemAddedModal.template,
        modalObj
      );
      this.pwa.appshell.elems.loadingOverlay.removeClass("loading");
      this.pwa.appshell.elems.body[0].insertAdjacentHTML(
        "beforeend",
        modalRendered
      );
      this.pwa.appshell.elems.body.find("#modalRegistryWrap")[0].focus();
      return true;
    } catch (e) {
      console.warn(`Unable to add item to registry. Error: ${e}`);
    }
    return false;
  }

  /**
   * Hides or shows the "Added to Registry" Modal
   * @returns undefined
   */
  registryItemAddedModalToggle() {}

  async getRegCtaData(ampDoc$) {
    try {
      await this.registryCtaDataGet();
      await this.registryCtaTempGet();
    } catch (e) {
      console.warn(`Failed to get data from all-registries API. Error: ${e}`);
    }
    this.registryCtaInitRender(location, ampDoc$);
    return this.registryCta.data;
  }

  /**
   * Get reg data for CTAs
   */
  async registryCtaDataGet() {
    if (!this.registryCta.data || !this.registryCta.data.data) {
      try {
        this.registryCta.data = await this.allRegDataGet();
      } catch (e) {
        console.warn(`Failed to get data from all-registries API. Error: ${e}`);
      }
    }
    return this.registryCta.data;
  }

  /**
   * Get reg template for CTA
   */
  async registryCtaTempGet() {
    if (!this.registryCta.template) {
      try {
        let tmp = await this.getRegistryTemplate();
        this.registryCta.template = $(tmp).find("#registryCta").html();
      } catch (e) {
        console.warn(`Error getting registry CTA template. Error: ${e}`);
      }
    }
    return this.registryCta.data;
  }

  /**
   * @returns {String} - html template
   */
  async getRegistryTemplate() {
    let tmpUrl = this.pwa.session.apiInfo.registryTemplates;
    let tmp = "";
    try {
      let tmpRes = await fetch(tmpUrl);
      return await tmpRes.text();
    } catch (e) {
      console.error(`Unable to fetch registry template. Error: ${e}`);
    }
    return;
  }

  /*****************************/
  /*** Mobile nav methods ***/
  /*****************************/

  /**
   * Get nav data when user changes active registry
   */
  async registryNavDataGet() {
    if (this.registryNav.data) return this.registryNav.data;

    // TODO - API call if user changes active registry
    try {
      this.registryNav.data = await this.allRegDataGet();
      //this.registryNav.data = await regNavDataFetch.json();
      this.activeRegistry =
        this.registryNav.data.data.activeRegistry.registryId;
    } catch (e) {
      console.warn(`Failed to get data from all-registries API. Error: ${e}`);
    }

    return this.registryNav.data;
  }

  /**
   * Get data that comes from all registries MS
   */
  async allRegDataGet() {
    // TODO - API call if user changes active registry
    try {
      var ATG_PROFILE_DATA = this.pwa.util.cookieGet("ATG_PROFILE_DATA");
      return await this.pwa.util.statefulFetch(
        `${location.origin}/apis/stateful/v1.0/customers/${ATG_PROFILE_DATA}/registry/all-registries`,
        {
          method: "GET",
          headers: Object.assign(
            {
              accept: "*/*",
              "atg-rest-depth": 2,
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );
    } catch (e) {
      console.warn(`Failed to get data from all-registries API. Error: ${e}`);
    }
    return null;
  }

  registryNavDataModify(regData) {
    let myObj = { activeReg: regData.activeRegistry.registryId };
    let otherRegistries = regData.registryList
      .filter(function (itm) {
        return myObj.activeReg !== itm.registryId;
      }, myObj)
      .slice(0, 2);
    regData.otherRegistries = otherRegistries;
    regData.numRegistries = regData.registryList.length;
  }

  /**
   * Render user-specific registry data in nav menu "registry" panel.
   * Needs to be rendered in every AMP document to deal with header amp-lists
   * @param {CashJsCollection} ampBody$ - AMP body
   * @returns undefined
   */
  async registryNavRender(ampBody$) {
    // ampBody$[0].registryNavRendered can be set to false in this.activeRegistryChange;
    if (ampBody$[0].registryNavRendered || !this.registryNav.template) return;

    const registryNav = this.registryNav;
    registryNav.data = await this.registryNavDataGet();

    let registryNavDom = $(this.pwa.$$$(ampBody$[0], "#registryNav"));

    let navCss = `
      <style>
        .registryNavHead {
          color: #002e62;
          font: 800 22px/1.27 var(--fontDisplay);
        }
        .babyNav .registryNavHead {
          color: #000;
          font: 300 24px/1.27 var(--fontDisplay);
        }
        .registryNavSphere {
          background: #002855;
          border-radius: 30.5px;
          color: #FFF;
          font: 600 14px/1.2 var(--fontMain);
          height: 61px;
          margin-left: 10px;
          padding: 14px;
          text-transform: uppercase;
          width: 61px;
        }
        .babyNav .registryNavSphere {
          background: #00a497;
        }
        .registryNavItem {
          text-transform: none;
        }
        .registryNavSpacer {
          margin-top: 3.25rem;
        }
        @media (min-width: 80rem) {
          #registryNav {
            border-right: 2px solid #cecece;
            margin-right: 3rem;
            width: 30%;
          }
          .registryNavHead {
            padding-right: 3rem;
          }
          .registryNavSpacer {
            margin-top: 0.5rem;
          }
        }
      </style>
    `;

    if (!registryNavDom.length) {
      let registryNavDomCont = $(
        `<div id="registryNav" class="${
          this.pwa.session.isBABY ? "babyNav" : ""
        }"></div>`
      );
      $(this.pwa.$$$(ampBody$[0], ".replacedRegistryNav")).replaceWith(
        registryNavDomCont
      );
      ampBody$.find("#navLayer2List").before(navCss);
      registryNavDom = $(this.pwa.$$$(ampBody$[0], "#registryNav"));
    }

    try {
      this.registryNavDataModify(this.registryNav.data.data);
    } catch (e) {
      console.warn(`error modifying registry Nav data. Error ${e}`);
    }

    this.registryNav.innerHtml = Mustache.render(
      registryNav.template,
      registryNav.data
    );

    registryNavDom.html(this.registryNav.innerHtml);

    ampBody$[0].registryNavRendered = true;
  }

  // is called if url has addToRegistry param added
  // adds to registry if only one, opens cta menu if more than one registry
  async registryParamRouter(ampBody$, urlObj) {
    const isPLP = this.pwa.session.docTests.isPLPReg.test(location.pathname);
    // rely on the ampListPostRender to add to registry
    if (isPLP) {
      this.renderCtaMenuFlag = true;
      return;
    }
    if (this.registryCta.data.data.registryList.length > 1) {
      let btn$ = ampBody$.find(".registryCta");
      btn$.removeAttr("data-reg-open");
      if (btn$.length) {
        this.registryCtaMenuRender(btn$, true);
      }
      // render menu in ampListPostRender
      this.renderCtaMenuFlag = true;
    } else {
      // if we clicked create registry button from friends list, and it returned with this param, we need to wait for data to be populated
      if (urlObj.searchParams.has("isPersonalized")) {
        await this.pwa.util.waitForElement(
          "#vendorIframeModal[data-personalize-ready]",
          ampBody$[0]
        );
      }
      this.registryItemAddedModalRender(
        this.registryCta.data.data.activeRegistry.registryId,
        {}
      );
    }
  }

  /*********************************/
  /*** Checklist Sidebar methods ***/
  /*********************************/

  registrySideBarClickHandler(argString, target$) {
    const ampBody$ = $(this.pwa.session.docObjActive.shadowBody);
    // close the checklist
    if (target$.is(".sidebarCloseCont")) {
      ampBody$.find(".registrySidebar").removeClass("registrySidebarShow");
    }

    // open active tab and close the one that was open
    if (target$.is(".tabActive .sidebarTabCont")) {
      target$.parent().removeClass("tabActive");
    } else if (target$.is(".sidebarTabCont")) {
      ampBody$.find(".tabActive").removeClass("tabActive");
      target$.parent().addClass("tabActive");
    }

    // render the other lists panel if it doesnt already exist
    if (target$.is("#otherLists")) {
      let regList = target$.parent().find(".registrySidebarPanel");
      if (!regList.length) {
        let content = this.registryPanelListTemplate(
          this.registryNav.data.data.registryList,
          "registrySidebarPanel",
          "0 0 21 6"
        );
        target$.parent().append(content);
      }
    }

    // change the registry if the user clicks in other list panel
    if (target$.is("[data-registry-id]")) {
      this.activeRegistryChange(ampBody$, argString);

      // this makes the transition look smoother
      ampBody$
        .find(".activeRegistry")
        .removeClass("activeRegistry")
        .find(".changeRegistryLink")
        .addClass("wHide");
      target$
        .addClass("activeRegistry")
        .find(".changeRegistryLink")
        .removeClass("wHide");
    }

    // open or close the checklist on desktop
    if (target$.is(".dskChecklistBtn, .sidebarOverlay")) {
      this.registrySidebarToggle(ampBody$);
    }
  }

  /**
   * Get sidebar checklist data when user changes viewports or active registry
   */
  async registrySidebarDataGet() {
    if (this.registrySidebar.data) return this.registrySidebar.data;

    try {
      // TODO - only do this when rendering Sidebar if doesn't exist
      const registryNavData = await this.registryNavDataGet();
      const registryId = registryNavData.data.activeRegistry.registryId;
      const registryType =
        registryNavData.data.activeRegistry.registryType.registryTypeName;
      const activeRegistryUrl = `${location.origin}/apis/stateful/v1.0/registry/${registryId}/interactive/checklist/${registryType}/dynamic/true`;
      // TODO - refactor dynSessConf header to deal with timeout across PWA.
      this.registrySidebar.data = await this.pwa.util.statefulFetch(
        activeRegistryUrl,
        {
          method: "GET",
          credentials: "include",
          headers: Object.assign(
            {
              accept: "application/json, text/plain, */*",
              "atg-rest-depth": 6,
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );
      //this.registrySidebar.data = await activeRegistryRes.json();
    } catch (e) {
      console.log("error fetching active registry data");
    }

    return this.registrySidebar.data;
  }

  async registrySidebarRender(ampBody$) {
    // Needs to be rendered in every AMP document to deal with header and wm_content DOM
    // ampBody$[0].registrySidebarRendered can be set to false in this.activeRegistryChange;
    if (ampBody$[0].registrySidebarRendered || !this.registrySidebar.template)
      return;

    // if showChecklist is false dont render the checklist
    let allRegData = await this.registryNavDataGet();
    if (allRegData.data && !allRegData.data.activeRegistry.showChecklist)
      return;

    const registrySidebar = this.registrySidebar;
    registrySidebar.data = await this.registrySidebarDataGet();

    let registrySidebarDom = ampBody$.find("#registrySidebar");

    if (!registrySidebarDom.length) {
      registrySidebarDom = $(
        `<div id="registrySidebar" class="${
          this.pwa.session.isBABY ? "babySidebar" : ""
        }"></div>`
      );
      ampBody$.prepend(registrySidebarDom);
    }

    const registrySidebarDomHtml = Mustache.render(
      registrySidebar.template,
      registrySidebar.data
    );

    registrySidebarDom.html(registrySidebarDomHtml);

    ampBody$[0].registrySidebarRendered = true;
  }

  // toggle sidebar on Desktop
  registrySidebarToggle(ampBody$) {
    ampBody$.find(".registrySidebar").toggleClass("registrySidebarShow");
    let checklistBtn = ampBody$.find(".dskChecklistBtn");
    checklistBtn.toggleClass("dskChecklistBtnActive");
    if (checklistBtn.hasClass("dskChecklistBtnActive")) {
      checklistBtn.removeAttr("data-modal-open");
    } else {
      checklistBtn.attr("data-modal-open", true);
    }
    ampBody$.find(".sidebarOverlay").toggleClass("active");
  }
}

class Sayt {
  /**
   * Site interface specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    /* reference to pwa coordinating class */
    this.pwa = pwa;
    this.debounceTopProd = "";
    this.prevSearchTerm = "";
    this.term = "";
    this.aSelect = "";
    this.boundSaytKeyUpEvent = this.saytKeyUpEvent.bind(this);
    this.boundLoadTopProductsConfig = this.loadTopProductsConfig.bind(this);
  }

  /**
   * Loads data for top product recommendations in search bar
   * @param {Hover Event} - Event fired from mouseover
   * @returns {Boolean}
   */
  async loadTopProducts(type, query, id, name) {
    if (query.trim() == "") return false;
    let storeId = "";
    let urlQuery = query;
    let apiUrl = this.pwa.session.apiInfo.topProductsApi;
    let fullUrl = "";
    try {
      let store = await this.pwa.amp.ampGetState("storeInfo", 250);
      storeId = store.data.store.storeId || "";
    } catch (e) {
      console.warn(`No store selected for top products.`);
    }
    if (!apiUrl)
      apiUrl = `https://em02-api-bbby.bbbypropertiestest.com/api/apps/bedbath_typeahead/top-products?web3feo=abc&isGroupby=true&isBrowser=true`;
    // set url based on which section was moused over
    if (type === "brand") {
      fullUrl = `${apiUrl}&q=${encodeURIComponent(
        urlQuery
      )}&brandId=${encodeURIComponent(id)}&storeId=${storeId}&site=${
        this.pwa.session.siteId
      }&__amp_source_origin=${encodeURIComponent(location.origin)}`;
    } else if (type === "category") {
      fullUrl = `${apiUrl}&categoryId=${encodeURIComponent(
        id
      )}&storeId=${storeId}&site=${
        this.pwa.session.siteId
      }&__amp_source_origin=${encodeURIComponent(location.origin)}`;
    } else if (type === "contentSearch") {
      fullUrl = `${
        location.origin
      }/apis/services/content/search/v1.0/items?q=${encodeURIComponent(
        urlQuery
      )}&start=0&perPage=3&site=${this.pwa.session.siteId}`;
    } else {
      fullUrl = `${apiUrl}&q=${encodeURIComponent(
        urlQuery
      )}&storeId=${storeId}&site=${
        this.pwa.session.siteId
      }&__amp_source_origin=${encodeURIComponent(location.origin)}`;
    }

    // JW - TODO - handle empty call on PLP - PLP navigation.
    try {
      const res = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
        },
      });
      const topProd = await res.json();
      topProd.query = type === "brand" || type === "category" ? name : query;

      // since they use different data formats, I need to clear these properties for templating to work correctly
      if (type === "contentSearch") {
        topProd.records = [];
        // ensure we only display 3
        topProd.response.docs = topProd.response.docs.slice(0, 3);
        topProd.contentSearch = true;
      } else {
        topProd.response = [];
        topProd.contentSearch = false;
      }
      this.pwa.amp.ampsSetState({ topProdSearchState: topProd });
    } catch (e) {
      console.error(
        `Unable to fetch top products for query: ${query}. Api url: ${apiUrl}`
      );
      return false;
    }
    return true;
  }

  /**
   * creates a proper data for calling loadTopProducts
   * @param {Object} evt - Event fired from mouseover or current item from keyupeventhandler
   */
  loadTopProductsConfig(evt) {
    let target$;
    // update target$ based on how the function was called
    if (evt.currentTarget) {
      target$ = $(evt.currentTarget);
      this.parent.find("#searchInput").val(this.term);
      this.lastKeySearchTerm = this.term;
    } else {
      target$ = evt;
    }
    if (
      target$.attr("data-type") === "contentSearch" ||
      target$.attr("data-type") === "ideaBoards"
    ) {
      this.debounceTopProd(target$.attr("data-type"), this.term);
    } else if (target$.attr("data-type")) {
      const brandOrCatId = /\/([0-9]*)\//.exec(target$.attr("data-link"))[1];
      const brandOrCatName = target$.attr("data-value");
      this.debounceTopProd(
        target$.attr("data-type"),
        this.term,
        brandOrCatId,
        brandOrCatName
      );
    } else {
      this.debounceTopProd("searchTerm", target$.text());
    }
  }

  /**
   * Sets mouse over and keyboard events for SAYT
   * @param {ampList} - called from ampListPostRender
   */
  topProductsRender(ampList) {
    this.parent = ampList.closest("#searchcontainer");
    this.term = this.parent.find("#searchInput").val();

    // gets hidden if searchterm doesn't exist and needs to be hidden on resize
    if (window.innerWidth > 1280) {
      this.parent.find(".topProducts").show();
    } else {
      this.parent.find(".topProducts").hide();
    }
    // throttle rendering and registering terms.
    if (this.prevSearchTerm == this.term) return;
    else this.prevSearchTerm = this.term;

    if (ampList.find("[data-listener]").length) return;

    if (
      typeof this.term == "string" &&
      this.term !== "null" &&
      this.term.length >= 2
    ) {
      try {
        let query = ampList.find(".typeAhead .searchLink").eq(0).text() || "";

        if (query && query.trim() !== "") {
          if (!this.debounceTopProd) {
            this.debounceTopProd = this.pwa.util.debounce(
              this.loadTopProducts.bind(this),
              350,
              false
            );
          }
          this.debounceTopProd("searchTerm", query);

          //Add mouseover events for search term top products
          //also add mouseover events for brands and categories top products
          ampList
            .find(".typeAhead .searchLink")
            .on("mouseover", this.boundLoadTopProductsConfig);

          ampList.find(".typeAhead").attr("data-listener", 1);

          //make search usable through arrows and enter keys
          // dont find the hidden a tags on mobile
          if (window.innerWidth < 768) {
            this.ampListLinks = ampList.find(
              "a:not(.searchLink:nth-of-type(1n+8))"
            );
          } else {
            this.ampListLinks = ampList.find("a");
          }
          this.aSelect = "";
          this.aIdx = 0;
          this.aLength = this.ampListLinks.length;
          this.lastKeySearchTerm = "";
          // remove keyup event from document before adding a new one
          ampList
            .closest("#searchcontainer")
            .off("keyup", this.boundSaytKeyUpEvent);
          ampList
            .closest("#searchcontainer")
            .on("keyup", this.boundSaytKeyUpEvent);
        } else {
          // hide this to prevent scrollbar from showing
          this.parent.find(".topProducts").hide();
        }
      } catch (e) {
        console.warn(
          `Unable to get search suggestions from state. Error: ${e}`
        );
      }
    }
    return;
  }

  /**
   * handle key board events for search, only handles up or down arrows currently
   * @param {Event} e - Event fired from keyup event added in topProductsRender
   */
  saytKeyUpEvent(e) {
    if (!this.parent.hasClass("active")) {
      return;
    }
    // arrow up
    if (e.which === 38) {
      // console.log("up pressed");
      if (this.aSelect) {
        this.aSelect.removeClass("navSelected");
        this.aIdx--;
        if (this.aIdx >= 0) {
          this.aSelect = $(this.ampListLinks[this.aIdx]).addClass(
            "navSelected"
          );
        } else {
          this.aSelect = this.ampListLinks.last().addClass("navSelected");
          this.aIdx = this.aLength;
        }
      } else {
        this.aSelect = this.ampListLinks.last().addClass("navSelected");
        this.aIdx = this.aLength;
      }
      this.lastKeySearchTerm = this.aSelect.text();
      this.parent.find("#searchInput").val(this.lastKeySearchTerm);
    }
    // arrow down
    else if (e.which === 40) {
      if (this.aSelect) {
        this.aSelect.removeClass("navSelected");
        this.aIdx++;
        if (this.aIdx < this.aLength) {
          this.aSelect = $(this.ampListLinks[this.aIdx]).addClass(
            "navSelected"
          );
        } else {
          this.aSelect = this.ampListLinks.first().addClass("navSelected");
          this.aIdx = 0;
        }
      } else {
        this.aSelect = this.ampListLinks.first().addClass("navSelected");
        this.aIdx = 0;
      }
      this.lastKeySearchTerm = this.aSelect.text();
      this.parent.find("#searchInput").val(this.lastKeySearchTerm);
    }
    // enter key handled in recentsearchformhandler
    // else if (e.which === 13) {
    // }

    // update topProdList based on which link is currently selected
    if (this.aSelect && (e.which === 40 || e.which === 38)) {
      this.boundLoadTopProductsConfig(this.aSelect);
    }
  }
}

/**
 * Site Customizations: things that vary site-to-site.
 *    Cart submisisons,
 *    Marketing campaigns,
 *    A-B testing,
 *    custom widgets,
 *    Personalization
 *    3rd party scripts,
 *    CSRF Token management
 *    Interaction layers
 */
class Site {
  /**
   * Site interface specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    /* reference to pwa coordinating class */
    this.pwa = pwa;

    // constants for stringifying and parsing facets
    this.GROUP_DELIMITER = "||";
    this.PAIR_DELIMITER = ":";
    this.ANGE_DELIMITER = "-";
    this.VALUE_DELIMITER = "|";
    this.RANGE_DELIMITER = "-";
    this.PRICE_KEY = "LOW_PRICE";
    this.STRIP_BOUNDING_QUOTES = /(^")|("$)/g;
    this.NUMBER_REG_EXP = /\d+(\.\d+)?/g;
    this.FACETS_REGEX =
      /(\/store\/(?:brand|category|s)\/[a-zA-Z0-9-_\/]+?)(?:_[a-zA-Z0-9-_]+\/)+((?:[A-Za-z0-9-_]{4})*(?:[A-Za-z0-9-_]{2}==|[A-Za-z0-9-_]{3}=)?)/;

    /* AMP -> PWA interaction handlers */
    this.interactions = [
      {
        paramKey: "type",
        paramVal: "pickItUp",
        handler: this.cartAdd,
        thisArg: this,
        stopNav: true,
        doNotClearParamsPlp: true,
      },
      {
        paramKey: "type",
        paramVal: "deliverIt",
        handler: this.cartAdd,
        thisArg: this,
        stopNav: true,
        doNotClearParamsPlp: true,
      },
      {
        paramKey: "type",
        paramVal: "cart",
        handler: this.cartAdd,
        thisArg: this,
        stopNav: true,
        doNotClearParamsPlp: true,
      },
      {
        paramKey: "type",
        paramVal: "multiSku",
        handler: this.cartAdd,
        thisArg: this,
        stopNav: true,
      },
      {
        paramKey: "type",
        paramVal: "addIdeaBoard",
        handler: this.pwa.ideaboard.ideaModalListBoards,
        thisArg: this.pwa.ideaboard,
        stopNav: true,
        doNotClearParamsPlp: true,
      },
      {
        paramKey: "type",
        paramVal: "pickItModal",
        handler: this.pwa.pickItModal.pickItInteraction,
        thisArg: this.pwa.pickItModal,
        stopNav: true,
        doNotClearParams: true,
      },
      {
        paramKey: "type",
        paramVal: "deliveryModal",
        handler: this.pwa.deliveryModal.initRender,
        thisArg: this.pwa.deliveryModal,
        stopNav: true,
      },
      // {
      //   paramKey: "type",
      //   paramVal: "plpRedirect",
      //   handler: this.pwa.plpLeftTest.plpParamRouter,
      //   thisArg: this.pwa.plpLeftTest,
      //   stopNav: true,
      // },
      {
        paramKey: "type",
        paramVal: "personalize",
        handler: this.pwa.personalize.personalizeParamRouter,
        thisArg: this.pwa.personalize,
      },
      {
        paramKey: "personalize",
        handler: this.pwa.personalize.personalizeParamRouter,
        thisArg: this.pwa.personalize,
      },
      {
        paramKey: "type",
        paramVal: "collectionAtc",
        handler: this.pwa.pdp.collectionParamRouter,
        thisArg: this,
        stopNav: true,
      },
      /* registry handles this param in registryCtaInitRender, added here for clarity
        {
          paramKey: "addToRegistry",
          paramVal: "true",
          handler: this.pwa.registry.registryParamRouter,
          thisArg: this.pwa.registry,
          stopNav: true,
        },
      */
      /* registry adds this in its constructor since registry is defined after site class, added here for clarity
        {
          paramKey: "action",
          paramVal: "appointment",
          handler: this.bookAppointmentRouted,
          thisArg: this.pwa.registry,
          stopNav: true,
        },

      */
    ];

    /* Bazaar voice passkey */
    this.bazaarVoiceKey = "caPP8r25N3Lb85qsfG7E6bwa4MTKEdtiKyoPMtCoKfRDI";

    /* AMP -> PWA interaction parameters */
    this.interactionParamsToClear = [
      // PLP interactions
      "removeInStock",
      "nearestStores",

      "personalize",
      // Interaction type
      "type",

      // Cart related
      "qty",
      "zipCode",
      "prodId",
      "storeId",
      "sddZip",
      "zip",
    ];

    /* PWA form submissions */
    this.formHandlers = {
      // plpIdea: "plpIdeaHandler",

      pdpIdeaboard: "formIdeaboardHandler",

      pdpPickIt: "formCartHandler",
      pdpDeliverIt: "formCartHandler",
      pdpShipIt: "formCartHandler",
      collectionsatc: "formCartHandler",
      // pdpRegisterIt: "pdpRegisterItHandler",
      pdpPersonalizeIt: "pdpPersonalizeItHandler",
      // pdpOosOnlineRedirect: "pdpOosOnlineRedirectHandler",

      pdpOosOnline: "pdpOosOnlineHandler",
      // pdpWarranty: "pdpWarrantyHandler",
      pdpWriteReviewForm: "writeReviewFromHandler",
      pdpReviewHelpful: "pdpReviewHelpfulHandler",
      pdpQaHelpful: "pdpReviewHelpfulHandler",

      recentSearchFormHandler: "recentSearchFormHandler",

      siteGiftcard: "siteGiftcardHandler",
    };

    /* Object to track navigation state variables for tealiumClickEventEmitter
      Not used for majority of Tealium Data, just nav-related state like these variables:
      plpListActions:
        plpFacetSelection - click on any checkbox from filter
        plpRemoveOneFacet - remove facet from PLP's
        plpClearAllFacets - click on clear all link
        plpSortBtnClick - click on Sort Button
        plpPaginationClick - click on pagination or next link
    */
    this.tealiumConfig = {};
  }

  /** Display Heads Up Modal
   * @param {Object} params - Add to cart parameters
   * @param {Object} storeClosestInStock - amp-state with store to pickup and store out of stock
   */
  async headsUp(params, storeClosestInStock) {
    try {
      // prepare to render heads up modal in this.pwa.appshell.modalHURender
      this.pwa.util.scriptAddMustache();

      this.pwa.appshell.modalHURender(params, storeClosestInStock);
    } catch (ex) {
      console.log(ex);
      this.pwa.appshell.modalHURender({
        error: "Unable to add to cart",
      });
    }
  }

  /**
   * Add an item to cart.
   * @param {Object} params - Add to cart parameters
   * @param {String} type - Add to cart type - pickItUp, deliverIt, cart (shipIt)
   * @param {URL} urlObj - url of the page that the cart sku is being added on.
   *   JW - 10.20.20 urlObj is temporary until all cart forms have a prodId input.
   */
  async cartAdd(params, type) {
    // Redirect if user adds Beyond+ Membership to cart, instead of adding it to the cart
    // Beyond+ Membership prod id == "1046959492"
    if (params.prodId == "1046959492") {
      location.href =
        location.origin + "/store/loyalty/beyondplus?isRedirect=true";
      return;
    }

    this.pwa.appshell.elems.loadingOverlay.addClass("loading");
    if (this.pwa.quickView.quickViewLoaded) this.pwa.quickView.quickViewClose();
    try {
      /*
        We need to pass LTL_FLAG_boolean as a param
        Right now this is slowing the add to cart call as we are waiting for all the data to load before we add to cart
        Which is not good for add to cart calls coming from amp to pwa
      */
      if (!/multiSku|collectionAtc/gi.test(params.type) && !params.ltlFlag) {
        /*
          Added here: LTL items (Truck Delivery)
          (https://www.bedbathandbeyond.com/store/product/amazonia-arizona-extendable-wood-oval-patio-dining-set/3317470?categoryId=13266)
          If sku data has LTL_FLAG as true, call this API (https://www.bedbathandbeyond.com/apis/stateful/v1.0/cart/shipping/ltl-options?skuId=62600200&locale=en)
          to get shipMethodId: "LT" and pass this value to add to cart API request in ltlShipMethod key
        */
        const ltlShipParams = await this.pwa.analytics.getLtlData({
          prodId: params.prodId,
          skuId: params.skuId,
        });
        if (ltlShipParams.ltlShipMethod) {
          params.ltlShipMethod = ltlShipParams.ltlShipMethod;
        }
      }

      // Pass along college Pack & Hold info
      try {
        const userState = JSON.parse(localStorage.getItem("user")) || {};
        const college = userState.college || {};
        if (college.isCollege || this.pwa.college.isCollege) {
          const favoriteStore = userState.favoriteStore || {};
          params.reserveNow = true;
          const reserveDate = this.pwa.college.regularBopis
            ? ""
            : favoriteStore.pickupDate || this.pwa.college.selectedDate || "";
          if (reserveDate) {
            params.reserveDate = new Date(reserveDate).toLocaleDateString(
              "en",
              { month: "numeric", day: "2-digit", year: "numeric" }
            );
          }
          params.pickupType = this.pwa.college.regularBopis
            ? "bopis"
            : "college";
          params.storeId = this.pwa.college.regularBopis
            ? params.storeId
            : favoriteStore.storeId || params.storeId;
        }
      } catch (err) {
        console.error("error adding college PH params to cart object", err);
      }

      // prepare to render cart results in this.pwa.appshell.modalCartRender
      this.pwa.util.scriptAddMustache();

      /*
        Moved this above the slider fetch due to needed one of the product Ids for a multiSku cart call
      */
      const addCartBody = this.cartObjMake(params, type);
      // Start fetching Card Modal Slider Assets, but do not await until
      // this.pwa.appshell.loadCartModalSlider rendering step.
      // Keep this separate from main Cart Add.
      let sliderProdId = params.prodId;
      if (addCartBody.addItemResults.length > 0 && !params.prodId)
        sliderProdId = addCartBody.addItemResults[0].prodId;
      const cartSliderFetches = [
        this.pwa.appshell.fetchCartSliderData(sliderProdId, params.type),
      ];
      if (!this.pwa.appshell.cartModalTmp)
        cartSliderFetches.push(
          this.pwa.appshell.fetchAppshellTmp(
            this.pwa.session.apiInfo.cartSlider,
            `cartSlider`
          )
        );

      /*
        Check if we have a cart error template, if not lets fetch it
        Note: if we decide to put the template for the cart modal in here instead of the appshell
        we will either want to await it or await the this.pwa.session.cartTemp,
        For now, this is just being used for the cartOosModal Template
      */
      this.pwa.pickItModal.loadTemplate();

      // submit add cart
      const addCartJsonString = `jsonResultString=${encodeURIComponent(
        JSON.stringify(addCartBody)
      )}`;
      const cartResObj = await this.pwa.util.statefulFetch(
        `${location.origin}/apis/stateful/v1.0/cart/item`,
        {
          body: addCartJsonString,
          credentials: "include",
          method: "POST",
          headers: Object.assign(
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );

      // Gather cart info
      /*
        No longer need this as the statefulFetch returns data
      */
      //const cartResObj = await cartRes.json();

      //Check for free shipping threshhold
      let freeShipping = false;
      let shipThreshhold = 39;
      let shipDiff = 0;
      let shipPromo = false;
      let itemsAdded = addCartBody.addItemResults.length || 0;
      let quantity = params.qty ? parseInt(params.qty) : 1;
      // For collections and product bundles we need to total the quantity added

      // Updating cart data for mini cart
      try {
        //quantity = cartResObj.data.component.quantity;
        if (type == "cart" || window.innerWidth >= 768) {
          this.pwa.session.miniCartData = await this.pwa.appshell.getCartData();
        }
      } catch (err) {
        /*
          Checking for Invalid or Missing _dynSessConf in request Heaader error and calling cart add again
        */
        console.warn(
          `Error getting current order details in cart add. Error: ${err}`
        );
      }

      let oosProductId = undefined;
      if (type == "collectionAtc") {
        try {
          let ampBody$ = this.pwa.session.docObjActive
            ? $(this.pwa.session.docObjActive.shadowBody)
            : [];
          //cartResObj.data.component.oosItems = [{oosProductId: 3295773}] //mock data

          if (ampBody$.find(".collectionCartOosError").length > 0) {
            let skuDefaultObj = {};
            // back qtyError default to false every product
            ampBody$.find(".cProdFullmentList").each(function (i, e) {
              let childItemId = $(e)
                .attr("id")
                .replace("cProdFulfillmentList", "");
              if (childItemId)
                skuDefaultObj[`skuFacets${childItemId}`] = { qtyError: false };
            });
            await this.pwa.amp.ampsSetState(skuDefaultObj);
          }

          //if found OOS qnty error for collection only
          if (
            cartResObj.data.component &&
            cartResObj.data.component.order &&
            cartResObj.data.component.order.oosItems &&
            cartResObj.data.component.order.oosItems[0]
          ) {
            // Error coming from amp to pwa transition, we need to wait for doc to load
            if (ampBody$.length == 0) {
              let doc = await this.pwa.util.waitForProp(
                "docObjActive",
                this.pwa.session
              );
              ampBody$ = $(doc.shadowBody);
            }
            this.pwa.appshell.elems.loadingOverlay.removeClass("loading");
            oosProductId =
              cartResObj.data.component.order.oosItems[0].oosProductId;
            let ffListNearDom = ampBody$.find(`#ffListTarget${oosProductId}`);

            let skuErrorObj = {};
            skuErrorObj[`skuFacets${oosProductId}`] = { qtyError: true };
            await this.pwa.amp.ampsSetState(skuErrorObj);

            if (ffListNearDom.length > 0) {
              ffListNearDom[0].scrollIntoView({
                behavior: "smooth",
              });
            }
          }
        } catch (e) {
          console.log("found OOS qnty error for collection", e);
          throw new Error(e);
        }
      }

      if (type == "multiSku" || type == "collectionAtc")
        quantity = addCartBody.addItemResults.reduce((acc, item) => {
          try {
            acc += parseInt(item.qty);
          } catch (e) {}
          return acc;
        }, 0);

      if (type == "cart") {
        try {
          const orderDetails = this.pwa.session.miniCartData;
          freeShipping =
            orderDetails.data.atgResponse.ClosenessQualifier.freeShippingBanner
              .showCongratsFreeShipMsg;
          shipDiff =
            orderDetails.data.atgResponse.ClosenessQualifier.freeShippingBanner
              .shippingDifference;
          shipThreshhold =
            orderDetails.data.atgResponse.ClosenessQualifier.freeShippingBanner
              .upperThreshold;
          shipPromo =
            orderDetails.data.atgResponse.ClosenessQualifier.freeShippingBanner
              .freeShippingPromo;
        } catch (e) {
          console.warn(`Unable to get shipping threshold. Error(${e})`);
        }
      }

      // Check if cart sticky needs to be rendered
      this.pwa.appshell.renderCartSticky();

      Object.assign(cartResObj, {
        isPickIt: type == "pickItUp",
        isDeliverIt: type == "deliverIt",
        isShipIt: type == "cart",
        isMultiSku: type == "multiSku" || type == "collectionAtc",
        isPersonalized: type == "personalize",
        itemsAdded: itemsAdded,
        itemQuantity: quantity,
        scene7Base: this.pwa.session.apiInfo.scene7RootUrl + "/",
        freeShippingEligible: freeShipping,
        shipThreshhold: shipThreshhold,
        shipDiff: shipDiff,
        freeShippingPromo: shipPromo,
        prodId: params.prodId,
        storeName: params.storeName || undefined,
        formatPrice: function () {
          return this.toFixed(2);
        },
        editQty: this.pwa.session.features.atcEditQuantity,
      });

      cartResObj.qtyOver2 = cartResObj.itemQuantity > 1;

      if (cartResObj.isPickIt) {
        let store = undefined;
        try {
          if (
            !cartResObj.storeName ||
            !/bed bath|harmon|buy buy baby/i.test(cartResObj.storeName)
          ) {
            store = await this.pwa.amp.ampGetState("storeInfo");
            cartResObj.storeName = cartResObj.storeName
              ? cartResObj.storeName
              : store.data.store.commonName;
            /*
              If the storeId is not the selected store, we will not have a full name.
              I may need to add a MS ticket to ask for full concept name on bopisInStockStore value
            */
            if (
              !/bed bath|harmon|buy buy baby/i.test(cartResObj.storeName) &&
              params.storeId == store.data.store.storeId
            ) {
              // add the store full name
              if (
                store.data.store.storeType == "10" ||
                store.data.store.storeType == "50"
              ) {
                cartResObj.storeName = `${cartResObj.storeName} Bed Bath & Beyond`;
              } else if (store.data.store.storeType == "40") {
                cartResObj.storeName = `${cartResObj.storeName} buybuy BABY`;
              } else if (store.data.store.storeType == "30") {
                cartResObj.storeName = `${cartResObj.storeName} Harmon Face Values`;
              }
            }
          }
          /*
              If store name is passed from changeStore, it will have the full store name
              If not, add the concept name
          */
        } catch (e) {
          console.warn(`cartAdd unable to get store name`);
        }
      }

      if (cartResObj.isDeliverIt) {
        let sddZip = params.sddZip;
        if (!sddZip) {
          try {
            let changeStore = await this.pwa.amp.ampGetState("changeStore");
            sddZip = changeStore.sddZipcode;
          } catch (e) {
            console.warn(`Unable to get seleced sdd zip`);
          }
        }
        cartResObj.sddZip = sddZip;
      }

      // make sure first item in data.component.order.commerceItemVOList is recently added item.
      // may not need to keep every item in this list but just in case I used the second filter to grab the unrelated skus to keep all of the data
      try {
        let currSkuAry =
          cartResObj.data.component.order.commerceItemVOList.filter(
            (a) => a.skuId == params.skuId
          );
        let notCurrSkuAry =
          cartResObj.data.component.order.commerceItemVOList.filter(
            (a) => a.skuId != params.skuId
          );
        cartResObj.data.component.order.commerceItemVOList =
          currSkuAry.concat(notCurrSkuAry);
      } catch (ex) {}
      if (this.pwa.college.isCollege && !this.pwa.college.regularBopis){
        cartResObj.storeName = this.pwa.college.favoriteStore.storeName
      }
      //if OOS product id for collection qnty, hide modal
      if (!oosProductId)
        this.pwa.appshell.modalCartRender(cartResObj, cartSliderFetches);
      try {
        let qty = cartResObj.data.component.order.cartItemCount;
        this.pwa.amp.ampsSetState({
          user: {
            data: {
              Cart: {
                itemCount: qty,
              },
            },
          },
        });
      } catch (ex) {
        console.warn("unable to update cart count", ex);
      }

      // add specific parameter to personalized add to cart
      if (cartResObj.isPersonalized) {
        cartResObj.product_has_personalization = true;
      }

      /* Add to cart click event for Tealium analytics */

      // scrape isPrice
      let activeBody = $(this.pwa.session.docObjActive.shadowBody);
      let currentPrice =
        activeBody
          .find(".pricesWrap amp-list:not([hidden]) .trackIsPrice")
          .text() || "";
      addCartBody.product_price = [currentPrice.trim()];

      // Moved to start of cartAdd so that LTL ship method can be send with cart data
      // const ltlShipParams = await this.pwa.analytics.getLtlData(params.skuId);
      const subscriptionEligible = Object.hasOwn(params, 'subscriptionItem');
      const subscriptionItem = params.subscriptionItem === 'true';
      const subscriptionFrequencyLabel = params.subscriptionEvery && params.subscriptionEvery !== "null" ? params.subscriptionEvery : "";
      if(subscriptionEligible){
        cartResObj.subscription_eligible = [subscriptionEligible];
        cartResObj.subscription_item = [subscriptionItem];
        cartResObj.subscription_frequency_label = [subscriptionFrequencyLabel];
      }
      cartResObj.cartFormSubmission = addCartBody;
      try {
        Object.assign(
          cartResObj.cartFormSubmission.addItemResults[0],
          ltlShipParams
        );
      } catch (err) {}

      let isPDP = this.pwa.session.docTests.isPDPReg.test(location.pathname);
      let cta;
      if (type == "pickItUp") {
        cta = isPDP ? "pdpPickItUpClick" : "plpPickItUpClick";

        // specific bopis related analytics items for college Pack and Hold features
        if (this.pwa.college.isCollege) {
          let collegeObj =
            this.pwa.college.createCollegeAnalyticsObj(addCartBody);
          try {
            Object.assign(
              cartResObj.cartFormSubmission.addItemResults[0],
              collegeObj
            );
          } catch (err) {}
        }
      } else if (
        type == "deliverIt" ||
        type == "cart" ||
        type == "personalize" ||
        type == "multiSku"
      ) {
        cta = isPDP ? "pdpShipIt" : "plpAddToCart";
      }
      let div = $(`<div data-cta='${cta}'></div>`);
      this.tealiumClickEventEmitter(div[0], cartResObj);

      /*else if (type == "deliverIt" || type == "cart" || type == "multiSku") {
        if (isPDP) {
          cta = "pdpAddToCartOnATCModal";
        } else {
          cta = "plpAddToCartOnATCModal";
        }
      }*/
      // let div = $(`<div data-cta='${cta}'></div>`);
      // this.tealiumClickEventEmitter(div[0], cartResObj);
      if (
        window.triggerLoadEvent &&
        this.pwa.session.docObjActive.ampPathSearch
      ) {
        let ampPathSearch = this.pwa.session.docObjActive.ampPathSearch;
        const pageParams = new URLSearchParams(ampPathSearch);

        const parsedAmpPathSearch = {};
        try {
          for (const [key, value] of pageParams) {
            parsedAmpPathSearch[key] = /dataLayer/.test(key)
              ? JSON.parse(decodeURIComponent(value))
              : value;
          }
        } catch (error) {
          for (const [key, value] of pageParams) {
            parsedAmpPathSearch[key] = /dataLayer/.test(key)
              ? JSON.parse(decodeURIComponent(encodeURIComponent(value)))
              : value;
          }
        }
        parsedAmpPathSearch.dataLayer = {
          ...parsedAmpPathSearch.dataLayer,
          page_name: "add to cart modal",
          call_to_actiontype: "add to cart modal",
        };

        let newAmpPathSearch = "";
        try {
          Object.keys(parsedAmpPathSearch).forEach((key) => {
            newAmpPathSearch += `${encodeURIComponent(key)}=${
              /dataLayer/.test(key)
                ? encodeURIComponent(JSON.stringify(parsedAmpPathSearch[key]))
                : parsedAmpPathSearch[key]
            }&`;
          });
        } catch (err) {
          newAmpPathSearch = "";
          Object.keys(parsedAmpPathSearch).forEach((key) => {
            newAmpPathSearch += `${encodeURIComponent(key)}=${
              /dataLayer/.test(key)
                ? encodeURIComponent(
                    decodeURIComponent(JSON.stringify(parsedAmpPathSearch[key]))
                  )
                : parsedAmpPathSearch[key]
            }&`;
          });
        }
        this.pwa.session.docObjActive.ampPathSearch = newAmpPathSearch;
        window.triggerLoadEvent(this.pwa.session.docObjActive.ampPathSearch);
      }
    } catch (ex) {
      console.log(ex);
      this.pwa.appshell.modalCartRender({
        error: "Unable to add to cart",
      });
    }
  }

  async toggleBeaconDisabledFlag(selector, switchString) {
    let ampBody$ = $(this.pwa.session.docObjActive.shadowBody);
    const gbScript = JSON.parse(ampBody$.find(selector).text());
    const ampAnalyticsId = selector.match(/[\w]+/i)[0];

    // Additional beacons can be added later if needed
    // key is amp-analytics id; value supplied by groupby
    const beacons = { groupByViewProduct: "viewProduct" };

    gbScript.extraUrlParams = gbScript.extraUrlParams || {};
    gbScript.extraUrlParams.experiments =
      gbScript.extraUrlParams.experiments || [];

    if (switchString == "disable") {
      gbScript.extraUrlParams.experiments.push({
        experimentId: "do_not_use",
        experimentVariant: beacons[ampAnalyticsId],
      });
    } else {
      gbScript.extraUrlParams.experiments =
        gbScript.extraUrlParams.experiments.filter(
          (x) => x.experimentId != "do_not_use"
        );
    }

    ampBody$.find("#groupByViewProduct script").text(JSON.stringify(gbScript));
  }

  /**
   * Order details api for free shipping information specifically related in cart items
   * Commented this out as I don't see it being used anymore
   */
  // async getOrderDetails() {
  //   const url = `${location.origin}/apis/stateful/v1.0/cart/current-order-details?type=mini&arg1=true`;
  //   let orderData = null;
  //   try {
  //     const res = await fetch(url, {
  //       credentials: "include",
  //       method: "GET",
  //       headers: Object.assign(
  //         {
  //           "Content-Type": "application/json",
  //         },
  //         await this.pwa.user.sessionConfirmationHeadersGetOrSet()
  //       ),
  //     });
  //     orderData = await res.json();
  //   } catch (e) {
  //     console.warn(`Unable to get order details. Error: ${e}`);
  //   }
  //   return orderData;
  // }

  /**
   * Makes 3 kinds of add to cart objects:
   *   PickIt, DeliverIt, ShipIt
   * @param {Object} params - cart form params
   * @param {String} type - cart type
   */
  cartObjMake(params, type) {
    // Common Cart Paramters & defaults

    let addItemResults = [];

    /*
      Check if we need to pass through registryId from the URL.
      This registryId param is present on links to buy a product for a specific user's registry.
      Submitting this param with the add to cart form marks the item as purchased
      in the appropriate registry.
      https://www.buybuybaby.com/store/product/waterwipes-reg-9-pack-baby-wipes/1020489205?skuId=20489205&registryId=549899561
      */
    const url = new URL(location.href);
    const registryId = url.searchParams.get("registryId");
    let qty = "1";
    try {
      qty = params.qty ? `${Math.abs(parseInt(params.qty))}` : "1";
    } catch (e) {
      console.log(`Could not parse quantity to number. Error: ${e}`);
    }

    const cartConfig = {
      bts: false,
      favStoreState: "null",
      ltlShipMethod: params.ltlShipMethod,
      level_of_service: params.level_of_service,
      mie: "false",
      porchPayLoadJson: "",
      prodId: params.prodId,
      qty: qty,
      refNum: "",
      registryId: registryId,
      skuId: params.skuId,
    };

    if (type == "pickItUp") {
      addItemResults.push(
        Object.assign({}, cartConfig, {
          reserveNow: "true",
          sddZipCode: null,
          storeId: params.storeId,
        })
      );

      if (this.pwa.college.isCollege) {
        Object.assign(addItemResults[0], {
          reserveDate: params.reserveDate,
          pickupType: params.pickupType,
        });
      }
    } else if (type == "deliverIt") {
      addItemResults.push(
        Object.assign({}, cartConfig, {
          rbyrItem: false,
          reserveNow: "undefined",
          sddItem: true,
          sddZipCode: params.sddZip || params.sddZipCode,
          storeId: null,
          warrantySkuId: "",
        })
      );
    } else if (type == "cart" && params.marketPlaceItem) {
      addItemResults.push(
        Object.assign({}, cartConfig, {
          rbyrItem: false,
          reserveNow: "undefined",
          sddItem: false,
          sddZipCode: null,
          storeId: null,
          warrantySkuId: "",
          marketPlaceItem: params.marketPlaceItem,
          marketPlaceItemOverSized: params.marketPlaceItemOverSized,
          marketPlaceOfferId: params.marketPlaceOfferId,
        })
      );
    } else if (type == "cart") {
      addItemResults.push(
        Object.assign({}, cartConfig, {
          rbyrItem: false,
          reserveNow: "undefined",
          sddItem: false,
          sddZipCode: null,
          storeId: null,
          warrantySkuId: "",
          subscriptionItem: params.subscriptionItem,
          subscriptionEvery: params.subscriptionEvery,
        })
      );
    } else if (type == "multiSku") {
      Object.keys(params).forEach((p) => {
        if (/multiSku/g.test(p)) {
          let [prodId, sku] = params[p].split(",");
          if (prodId && sku) {
            addItemResults.push(
              Object.assign({}, cartConfig, {
                skuId: sku,
                prodId: prodId,
                qty: "1",
                rbyrItem: false,
                reserveNow: "undefined",
                sddItem: false,
                sddZipCode: null,
                storeId: null,
                warrantySkuId: "",
              })
            );
          }
        }
      });
    } else if (type == "personalize") {
      addItemResults.push(
        Object.assign({}, cartConfig, {
          rbyrItem: false,
          refNum: this.pwa.personalize.personalizedSku[params.skuId].refnum,
          reserveNow: "undefined",
          sddItem: false,
          sddZipCode: null,
          storeId: null,
          warrantySkuId: "",
          subscriptionItem: params.subscriptionItem || "false",
          marketPlaceItem: params.marketPlaceItem || false,
          marketPlaceItemOverSized: params.marketPlaceItemOverSized || false,
          marketPlaceOfferId: params.marketPlaceOfferId || "",
        })
      );
    } else if (type == "collectionAtc") {
      /*
        TO DO: this may not work with interaction from amp to PWA as state
        Probably need to figure out if I can pass sddZip from amp
        and changeStore probably will not be set and amp state will not be initialized
      */
      let products = JSON.parse(
        decodeURIComponent(params.products).replace(/},]/i, "}]")
      );
      products.forEach((item, i) => {
        if (item.qty && item.qty !== "0" && item.qty != "null") {
          addItemResults.push(
            Object.assign({}, cartConfig, {
              skuId: item.skuId,
              prodId: item.prodId,
              qty: item.qty,
              rbyrItem: false,
              reserveNow: "undefined",
              sddItem: item.fulfillment == "deliverIt" ? true : null,
              sddZipCode:
                item.fulfillment == "deliverIt" ? params.sddZip : null,
              storeId: item.fulfillment == "pickItUp" ? params.storeId : null,
              warrantySkuId: "",
            })
          );
          if (item.LTL_FLAG == true || item.LTL_FLAG == "true")
            addItemResults[addItemResults.length - 1].ltlShipMethod = "LT";
        }
      });
    }

    return { addItemResults };
  }

  /**
   * Intercepts PWA cart form Submission adds to cart via AJAX instead.
   * @param {CashJsCollection} form - jQuery-like form object
   */
  async formCartHandler(form) {
    this.pwa.appshell.elems.loadingOverlay.addClass("loading");
    const params = this.pwa.util.formToObject(form);

    // JW - 5.1.21 - attempt to root out which cookies are breaking session-confirmation API
    // debugger;
    // document.cookie =
    //   "dynSessionConfNumber=;  max-age=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    // const rootDomainMatch = /\.[^.]*\.[^.]*$/.exec(location.hostname);
    // let rootDomain = rootDomainMatch ? rootDomainMatch[0] : location.hostname;
    // document.cookie = `dynSessionConfNumber=; domain=${rootDomain}; max-age=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    // document.cookie = `atgRecVisitorId=; domain=${rootDomain}; max-age=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    // document.cookie = `atgRecSessionId=; domain=${rootDomain}; max-age=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    // document.cookie = `securityStatus=; domain=${rootDomain}; max-age=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;

    if (params.type == "collectionAtc") {
      // Collections validation
      let formErrors = form.closest("#second").find(".collectionOosError");
      if (formErrors.length > 0) {
        // scroll to error and abort cart call
        // Close modal overlay
        this.pwa.appshell.elems.loadingOverlay.removeClass("loading");
        formErrors[0].scrollIntoView({
          block: "center",
          behavior: "auto",
          inline: "center",
        });
        return false;
      }
    }

    if (
      this.pwa.session.docTests.isPDPReg.test(location.pathname) &&
      params.type === "pickItUp"
    ) {
      const headsUpModalState = await Promise.race([
        // PDPv1
        this.pwa.amp.ampGetState("storeClosestInStock"),
        // PDPv2
        this.pwa.amp.ampGetState("headsUpModal"),
        this.pwa.amp.ampGetState("collectionStatus"),
      ]);
      /*
        Checking that bopisInStockStoreId equals the storeId passed with params to make sure that and item isn't added from accessories or collections
        Additionally, checking that the item was not added to cart from pickItModal by checking ancestor of form element
      */

      if (
        headsUpModalState.closestStoreOutStockName &&
        headsUpModalState.bopisInStockStoreId &&
        headsUpModalState.bopisInStockStoreId == params.storeId &&
        form.closest(".pickItModal").length == 0
      ) {
        this.headsUp(params, headsUpModalState);
      } else {
        this.cartAdd(params, params.type);
      }
    } else {
      this.cartAdd(params, params.type);
    }

    return true;
  }

  /**
   * Intercepts GET style form navigation and
   * adds to ideaboard via AJAX instead.
   * @param {CashJsCollection} form - jQuery-like form object
   */
  formIdeaboardHandler(form) {
    const params = this.pwa.util.formToObject(form);
    this.pwa.ideaboard.ideaModalListBoards(params);
    return true;
  }

  /**
   * Ensures that PWA form handlers fire instead of AMP form handlers.
   *
   * For forms in amp-lists & secondary page loads, the AMP framework registers
   * AMP event handlers before the PWA gets the opportunity to. This detaches/invalidates those handlers.
   *
   * form[type="get"][data-pwa-handler] cart forms are interaction redirects from
   * amp pages to canonical site. Use PWA form handling instead of AMP form handling.
   * This allows us to use the session-confirmation API to get
   * Oracle ATG security headers for forms like "Add to Cart"
   *
   * form[type="get"][data-pwa-handler] search form should actually redirect
   *
   * @param {context} context - jQuery like object. ampDoc || amp-list
   */
  formPwaHandlerOnly(context) {
    context.find("form[data-pwa-handler]").each((i, e) => {
      let form = $(e);
      const handler = form.attr("data-pwa-handler");
      const formRequiresAmpBind =
        /pdpPickIt|pdpDeliverIt|pdpShipIt|pdpIdeaboard|pdpOosOnline|siteGiftcard|collectionsatc/i;
      if (formRequiresAmpBind.test(handler)) {
        // AMP features (amp-bind) required in form, but URL is not required - new behavior
        // We only need the [data-pwa-handler] attribute & the form elements (for serializing the form).
        // ex: all cart forms, data-pwa-handler="pdpIdeaboard",
        form.each(this.pwa.formSubmitHandlerRegistration.bind(this.pwa));
        form.attr({
          method: "post",
          action: "",
        });
      } else {
        // AMP features are not required, URL is required - old behavior
        // ex: search form
        const newForm = form.clone();
        newForm.each(this.pwa.formSubmitHandlerRegistration.bind(this.pwa));
        form.replaceWith(newForm);
      }
    });
  }

  /**
   * Routes form submissions to appropritate site form handlers
   * @param {CashJsCollection} form - jQuery-like form object
   * {boolean} - Whether this form was fully handled.
   *  false - AMP framework should also handle form.
   *  true - PWA has fully handled form.
   */
  formSubmitRouter(form) {
    const formType = form.attr("data-pwa-handler");
    const handler = this.formHandlers[formType];
    if (handler) {
      return this[handler](form);
    } else {
      return false;
    }
  }
  /**
   *
   * @param {HTMLEvent} e -  Browser event object fired from file input element
   * @returns {undefined}
   */
  async handleReviewPhotos(e) {
    const key = "caPP8r25N3Lb85qsfG7E6bwa4MTKEdtiKyoPMtCoKfRDI";
    const baseUrl = "https://api.bazaarvoice.com/data/uploadphoto.json";
    const queryStr = `apiversion=5.4&passkey=${key}&contenttype=Review&locale=en_US`;
    const fileList = this.files;
    if (fileList.length > 0) {
      const fullUrl = `${baseUrl}?${queryStr}`;
      try {
        const formData = new FormData();
        formData.append("photo", fileList.item(0));
        const res = await fetch(fullUrl, {
          method: "POST",
          body: formData,
          headers: {
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "cross-site",
          },
        });
        const resData = await res.json();
        if (resData.HasErrors) {
          try {
            let errorTxt = resData.FormErrors.FieldErrors.photo.Message;
            updateError(errorTxt);
          } catch (e) {
            updateError();
          }
        } else {
          $("#reviewPhotoError").addClass("hide").removeClass("show");
          updatePhotos(resData);
        }
        // call appshell function to update the Appshell
      } catch (e) {
        console.warn(`Unable to upload photo. Error: ${e}`);
        updateError();
      }
    }
    return;
    /**
     *
     * @param {Object} res - response from submitting photo to bazaarvoice
     */
    function updatePhotos(res) {
      try {
        let photosNode = $("#reviewThumbContainer");
        let imgUrl = res.Photo.Sizes.normal.Url;
        let thumbUrl = res.Photo.Sizes.thumbnail.Url;
        let photoCnt = photosNode.find(".photoInput").length;
        let thumb = `
        <div class="thumbContainer" id="thumbContainer_${photoCnt}">
          <input type="hidden" class="photoInput" value="${imgUrl}" name="photourl_${
          photoCnt + 1
        }">
          <img src="${thumbUrl}" class="photoNode">
          <span class="removePhoto">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="8" height="8" id="CloseIcon"><path fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.474 1.748L1.526 14.252m0-12.504l12.948 12.504"></path></svg>
          </span>
        </div>`;
        photosNode.append(thumb);
      } catch (e) {
        updateError(
          "Photo uploaded successfully but was unable to display a thumbnail"
        );
      }
    }
    /**
     *
     * @param {String} msg - optional message for error
     * @returns {Boolean}
     */
    function updateError(msg) {
      let errorNode = $("#reviewPhotoError");
      if (errorNode.length > 0) {
        if (msg) {
          errorNode.text(msg);
        }
        errorNode.removeClass("hide");
        errorNode.addClass("show");
        return true;
      }
      return false;
    }
  }

  /**
   * Device fingerprint library needed to submit Bazaar Voice forms.
   * @returns {undefined}
   */
  loadBlackBox() {
    window.IGLOO = window.IGLOO || {
      enable_rip: true, // Enable Real IP protection.
      enable_flash: false, // Disable flash
      install_flash: false, // Don't ask user to install flash
      loader: {
        version: "general5", // Non-experimental 5.x updates
        fp_static: false, // Don't load 1st party resources
      },
    };
    if (typeof window.IGLOO.getBlackBox !== "function") {
      this.pwa.util.scriptAdd(
        `${location.origin}/static/assets/js/iovation.js`
      );
    }
    return;
  }

  /**
   *
   * @param {CashJsCollection} form - jQuery-like form object
   */
  async pdpReviewsHelpfulHandler(str, targ$) {
    targ$.attr("disabled");
    const contentId = targ$.attr("data-qId");
    const action = targ$.attr("data-vote");
    const type = targ$.attr("data-type");
    const postUrl = `https://api.bazaarvoice.com/data/submitfeedback.json?apiversion=${this.pwa.session.apiInfo.bazaarvoiceApiVersion}&feedbackType=helpfulness&action=submit&locale=${this.pwa.session.apiInfo.bazaarvoiceLocal}&contentId=${contentId}&contentType=${type}&passkey=${this.pwa.session.apiInfo.bazaarvoiceApiKey}&vote=${action}`;
    try {
      const resp = await fetch(postUrl, {
        method: "POST",
        headers: {
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
        },
      });
      const respJson = await resp.json();
      this.updateHelpfulForm(targ$.parent(), respJson, targ$);
    } catch (e) {
      console.warn(`Unable to submit helpful vote. Error: ${e}`);
      this.updateHelpfulForm(targ$.parent(), { HasErrors: true }, targ$);
    }
  }

  /**
   *
   * @param {CashJsCollection} form - jQuery-like form object
   * @param {Object} formData - Response from form submission
   * @param {String} formUrl - Current form action
   */
  updateHelpfulForm(form, formData, formBtn) {
    function addError(f) {
      if (f.find(".error").length == 0) {
        f.append(
          `<span class="error alert helpfulError">There was a problem submitting your vote</span>`
        );
      }
    }
    function removeError(f) {
      f.find(".error").remove();
    }
    try {
      removeError(form);
      if (formData.HasErrors) {
        addError(form);
        return;
      }

      let vote = formData.Feedback.Helpfulness.Vote;
      let cntNode = form.find(".helpfulCnt");
      let cnt = parseInt(cntNode.text());
      if (vote == "POSITIVE") {
        formBtn.attr("data-vote", "negative");
        cntNode.text(cnt + 1);
      } else {
        formBtn.attr("data-vote", "positive");
        cntNode.text(cnt - 1);
      }
    } catch (e) {
      console.warn(
        `Unable to render the helpfulness form response. Error: ${e}`
      );
      addError(form);
    }
    formBtn.removeAttr("disabled");
  }

  /**
   * This handles the transition from native amp to PWA with the OOS form.
   * I could not do this with the interaction param as I had to set state and therefore needed a doc obj
   * This was a last minute change and was trying to be as low risk as possible.
   * @param {CashJs Node} ampDoc$
   */
  pdpOosModalHandler(ampDoc$) {
    try {
      let url = new URL(location.href);
      ampDoc$.find(".outOfStockCont").addClass("active");
      this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "u", {
        outOfStockModal: true,
      });
      url.searchParams.delete("type");
      history.replaceState("", document.title, url.toString());
    } catch (e) {
      console.warn(`Unable to trigger OOS modal`);
    }
  }

  /**
   *
   * @param {CashJs Collection} ampList - ampList CashJs object that contains the OOS form
   * @returns undefined;
   */
  async pdpOosAmpHandler(ampList) {
    try {
      let url = new URL(location.href);
      let form = ampList.find(
        '.i-amphtml-replaced-content [data-pwa-handler="pdpOosOnline"]'
      );
      if (
        form.length == 0 ||
        url.searchParams.get("type") !== "oosForm" ||
        form[0].hasAttribute("hidden")
      )
        return;
      let paramsToClear = [];
      url.searchParams.forEach((value, key) => {
        form.find(`input[name="${key}"]`).val(value);
        if (form.find(`input[name="${key}"]`).length > 0)
          paramsToClear.push(key);
      });
      paramsToClear.forEach((param) => url.searchParams.delete(param));
      form.trigger("submit");
      form[0].scrollIntoView({
        block: "center",
        behavior: "auto",
        inline: "center",
      });
      history.replaceState("", document.title, url.toString());
    } catch (e) {
      console.log(`Unable to handle oos form from amp. Error: ${e}`);
    }
    return;
  }

  /**
   *
   * @param {CashJsCollection} form - amp form with validation.
   * @returns {undefined}
   */
  async pdpOosOnlineHandler(form) {
    let sess;
    let resData;
    const matchHandler = this.pwa.util.createInputMatchHandler({
      useForm: true,
    });
    let valid = this.pwa.appshell.validateForm(form[0]);
    let match = matchHandler(form);
    if (!valid || !match) {
      this.formValidationHandler = this.formValidationHandler
        ? this.formValidationHandler
        : (e) => {
            this.pwa.appshell.validateForm(e.currentTarget);
          };
      $(form).addClass("amp-form-submit-error");
      form[0].removeEventListener("change", this.formValidationHandler);
      form[0].addEventListener("change", this.formValidationHandler);
      return;
    } else {
      $(form).removeClass("amp-form-submit-error");
    }
    const queryParams = $(form).serialize();
    try {
      resData = await this.pwa.util.statefulFetch(
        this.pwa.session.apiInfo.apiOutOfStockForm,
        {
          body: queryParams,
          credentials: "include",
          method: "POST",
          headers: Object.assign(
            {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            await this.pwa.user.sessionConfirmationHeadersGetOrSet()
          ),
        }
      );
      //resData = await res.json();
      const status = resData.serviceStatus;
      if (status == "SUCCESS") {
        this.pwa.amp.ampsSetState({ outOfStockFormSuccess: true });
      } else {
        throw new Error("Errors submitting oos from", resData);
      }
    } catch (e) {
      $(form).addClass("amp-form-submit-error");
      console.warn(
        `Prolbem submitting PDP out of stock notification form. Error: ${e}`
      );
    }
    return;
  }

  /**
   *
   * @param {CashJsCollection} form - jQuery-like form object
   * This function handles form submission from personalize click on pdp and opens the personalize modal or adds the item to the cart
   */
  async pdpPersonalizeItHandler(form) {
    let prodId = form.find("[name=prodId]").val();
    let skuId = form.find("[name=skuId]").val();
    if (!this.pwa.personalize.personalizedSku[skuId]) {
      this.pwa.personalize.openModal(skuId);
    } else {
      const params = this.pwa.util.formToObject(form);
      // not sure why quantity wasnt being updated, should fix this in native amp but doing it here so it can be released
      let skuFacet = await this.pwa.amp.ampGetState(`skuFacets${prodId}`);
      params.qty = skuFacet.qty || "1";
      await this.cartAdd(params, "personalize");
      // TODO: add to bottom of cartAdd so it is only removed if there was no issue adding it to cart
      this.pwa.personalize.removeData(skuId);
    }
    return true;
  }

  /**
   *
   * @param {CashJsCollection} form - jQuery-like form object
   * This function handles both the write a review form submission and the ask a question form submission
   */
  async writeReviewFromHandler(form) {
    // TODO: put passkey and api version in extraWompLib session variables
    let staticParams = {
      passkey: null,
      apiversion: null,
      sendemailalertwhenpublished: true,
      sendemailalertwhencommented: true,
      sendemailalertwhenanswered: true,
      locale: null,
      action: "submit",
    };
    try {
      staticParams.passkey = this.pwa.session.apiInfo.bazaarvoiceApiKey;
      staticParams.apiversion = this.pwa.session.apiInfo.bazaarvoiceApiVersion;
      staticParams.locale = this.pwa.session.apiInfo.bazaarvoiceLocal;
    } catch (e) {
      console.warn(`Unable to get apiInfo from session. Error: ${e}`);
    }
    let formAction = form.attr("action");
    try {
      let fp = this.getDeviceFingerprint();
      let calls = 0;
      while (!fp && calls < 4) {
        fp = this.getDeviceFingerprint();
        calls += 1;
      }
      staticParams.fp = fp;
    } catch (e) {
      console.error(
        `Unable to get the device fingerprint to submit the review form. Error: ${e}`
      );
    }
    //let paramObj = this.inputsNodesToObj(form);
    let paramObj = this.pwa.util.formToObject(form);
    /*
      Added check to make sure paramObj.email existed before setting it.
      This was breaking the QA form as it still used useremail and it was coming in as undefined
    */
    if (paramObj.email) {
      paramObj.useremail = paramObj.email;
      delete paramObj.email;
    }
    const reviewFormObj = Object.assign(staticParams, paramObj);
    let queryStr = this.objToQueryStr(reviewFormObj);
    try {
      const url = `${formAction}?${queryStr}`;
      const reviewRes = await fetch(url, {
        method: "POST",
        headers: {
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
        },
      });
      const formResData = await reviewRes.json();
      this.pwa.appshell.renderReviewFormResponse(formResData, form);
      // Do something with response
    } catch (e) {
      console.warn(`Unable to submit form . Error ${e}`);
      this.pwa.appshell.renderReviewFormResponse(
        {
          Errors: ["Error submitting form. Please try again later"],
        },
        form
      );
    }
  }

  /**
   *
   * @param {HTMLDocument} doc
   * @param {URL} urlObj - Url object
   * @returns {undefined}
   */
  async scrapeProdData(doc, urlObj, modalType) {
    let imgSrc;
    let title;
    let productId;
    try {
      this.pwa.util.scriptAddMustache();
      this.loadBlackBox();
    } catch (e) {
      console.warn(
        `Error loading libraries for write review modal. Error: ${e}`
      );
    }
    try {
      // scrape the main img url for the modal
      const prodImg = doc.find("#prodSlideCarousel img");
      imgSrc = prodImg.attr("src");
      imgSrc = imgSrc ? imgSrc : null;

      // scrape the title from the document
      let titleCls = "title";
      if (this.pwa.session.isPdpV2) titleCls = "prodTitle";
      title = doc.find(`.${titleCls}`).text();
      title = title ? title : null;

      // Get the product id
      productId = this.prodIdGet(urlObj);
      if (productId) {
        await this.pwa.appshell.modalWriteReviewRender(
          title,
          imgSrc,
          productId,
          modalType
        );
      }
    } catch (e) {
      console.warn(
        `Unable to get the data to display review modal. Error: ${e}`
      );
    }
    return;
  }

  /**
   * @returns {String} - Encoded device fingerprint from iovation. Used for Bazaarvoice POST
   */
  getDeviceFingerprint() {
    if (typeof window.IGLOO.getBlackbox !== "function") {
      return null;
    }
    var bbData = window.IGLOO.getBlackbox();
    if (bbData.finished) {
      return bbData.blackbox;
    }
  }

  /**
   *
   * @param {CashJsCollection} form - from to turn inputs into object
   * @returns {Object} - Key value pairs {name: value}
   */
  inputsNodesToObj(form) {
    let paramObj = {};
    form.find("input,textarea").each(function (item) {
      let name = this.name;
      let val = this.value;
      if (name && val) {
        if (this.type !== "radio" || this.checked) {
          paramObj[name] = val;
        }
      }
    });
    return paramObj;
  }

  /**
   * Sets an amp state by parsing a state object from a data attriubte
   * Mostly for the mouseout event
   * @param {Mouseout Event Object} obj
   */
  handleAmpAction(breakpoint, evt) {
    if (window.innerWidth < breakpoint) return;
    let target$ = $(evt.target);
    let relatedClass = $(evt.relatedTarget).attr("class");
    let related = target$.attr("data-related");
    let state = target$.attr("data-state");
    let test = target$.attr("data-interact-test");
    if (!state) return;
    let stateObj = {};
    try {
      stateObj = JSON.parse(state);
      if (
        (relatedClass && related && relatedClass.indexOf(related) == -1) ||
        !related
      ) {
        if (!test || target$.hasClass(test)) this.amp.ampsSetState(stateObj);
      }
    } catch (e) {
      console.warn(`handleAmpAction: Unable to parse data-state. Error: ${e}`);
    }
  }

  /**
   * Desktop only. Check if search is open, if it is, close it
   * JW TODO - Can we get rid of this? I suspect all of these states would be better handled in native amp.
   * @param {Event Object} evt - Body click
   */
  async dskCloseOnClick(evt) {
    let state = null;
    let target$ = $(evt.target);
    let body$ = target$.closest("body");
    function setObj(st, setObj) {
      return st == null ? Object.assign({}, setObj) : Object.assign(st, setObj);
    }
    try {
      if (
        target$.closest("header").length &&
        target$.closest(".csModal, #csBannerList").length == 0
      ) {
        state = setObj(state, { changeStore: { csModal: false } });
      }
      if (
        target$.closest("#searchcontainer").length == 0 &&
        body$.find("#searchcontainer").hasClass("active")
      ) {
        state = setObj(state, { u: { search: null } });
      }
      if (
        target$.closest(".ssMRad").length == 0 &&
        body$.find(".ssMRad").length > 0 &&
        !body$.find(".ssMRad").hasClass("hide")
      ) {
        state = setObj(state, { changeStore: { radiusModal: false } });
      }
      if (target$.hasClass("ssModal")) {
        state = setObj(state, { changeStore: { ssModal: false } });
      }
      if (
        target$.closest(".findCollegeStateModal").length == 0 &&
        body$.find(".findCollegeStateModal").length > 0 &&
        !body$.find(".findCollegeStateModal").hasClass("hide")
      ) {
        state = setObj(state, { changeCollege: { searchStateModal: false } });
      }
      if (
        target$.closest(".findCollegeSchoolModal").length == 0 &&
        body$.find(".findCollegeSchoolModal").length > 0 &&
        !body$.find(".findCollegeSchoolModal").hasClass("hide")
      ) {
        state = setObj(state, { changeCollege: { searchSchoolModal: false } });
      }
      if (target$.hasClass("findMyCollegeModal")) {
        state = setObj(state, { changeCollege: { findMyCollegeModal: false } });
      }
      if (state) {
        this.pwa.amp.ampsSetState(state);
      }
    } catch (e) {
      console.warn(`Error closing search. Error: ${e}`);
    }
  }

  /**
   *
   * @param {Object} obj - object to convert into search parameters
   * @return {String} - Encoded url query string
   */
  objToQueryStr(obj) {
    const keys = Object.keys(obj);
    return keys.reduce((acc, item, ind, arr) => {
      let nm = encodeURIComponent(item);
      let v = encodeURIComponent(obj[item]);
      if (v) {
        acc += `${nm}=${v}`;
        acc += ind + 1 < arr.length ? "&" : "";
      }
      return acc;
    }, "");
  }

  /**
     * Handles "Interaction Layer" requests from amp pages:
     *   JS and domain-based functionality that only
     *   the canonical site can handle.
     *
     *
     * Test Suite 1
          PLP - Test page: https://www-bedbathandbeyond-com.cdn.ampproject.org/c/s/www.bedbathandbeyond.com/amp/store/category/furniture/small-space-furniture/14991/

          1. "View Collections" button - needs to scroll to and open collections tab - (womp test results: nothing happens)
              https://www.bedbathandbeyond.com/store/product/dorm-desk-study-station/821046?categoryId=14991#collections

          2. "Choose Options" button
              https://www.bedbathandbeyond.com/store/product/manhattan-comfort-liberty-floating-desk/5418852?categoryId=14991

          3. "Pick It Up" button - hidden now because store selector goes to canonical site.

          4. "Free 2 hour Pickup" - primary store (top level checkbox) - (womp test results: storeId needs to override latLngCookie, currently is not.)
              https://www.bedbathandbeyond.com/store/category/furniture/small-space-furniture/14991/store-609?removeInStock=true

          5. "Free 2 hour Pickup" - primary store and nearby stores (choose nearby store from "change or add stores") - (womp test results: storeId needs to override latLngCookie, currently not working).
              https://www.bedbathandbeyond.com/store/category/furniture/small-space-furniture/14991/store-609?removeInStock=true&nearestStores=371

          6. "Click on Reviews Stars in product card" - Should open pdp and scroll to open reviews section
              https://www.bedbathandbeyond.com/store/product/manhattan-comfort-liberty-floating-desk/5418852?categoryId=14991#reviews

        Test Suite 2 - Canonical only, PWA does not handle personalization.
        Personalize - Test page: https://www.bedbathandbeyond.com/amp/store/category/personalized-gifts/personalized-bedding/13943/
        https://www-bedbathandbeyond-com.cdn.ampproject.org/c/s/www.bedbathandbeyond.com/amp/store/category/personalized-gifts/personalized-bedding/13943/

          6. Personalize -  - (womp test results: does not work for anonymous users)
              https://www.bedbathandbeyond.com/store/product/personalized-elegant-couple-throw-pillow/5247912?categoryId=13943&personalize=true

        Test Suite 3
        PDP Test Page: https://www-bedbathandbeyond-com.cdn.ampproject.org/c/s/www.bedbathandbeyond.com/amp/store/product/wamsutta-reg-pima-500-thread-count-sheet-set/3310408

          6.5 Add to ideaboard
              https://www.bedbathandbeyond.com/store/product/wamsutta-reg-pima-500-thread-count-sheet-set/3310408?type=addIdeaBoard&ignoreItemDetails=false&productId=3310408

          7. Pick It Up
              https://www.bedbathandbeyond.com/store/product/wamsutta-reg-pima-500-thread-count-sheet-set/3310408?qty=1&skuId=47131811&type=pickItUp&storeId=374&_gl=

          8. Deliver It
              https://www.bedbathandbeyond.com/store/product/wamsutta-reg-pima-500-thread-count-sheet-set/3310408?type=deliverIt&qty=1&skuId=47133563&sddZip=07083

          9. Add to Cart
              https://www.bedbathandbeyond.com/store/product/wamsutta-reg-pima-500-thread-count-sheet-set/3310408?type=cart&qty=1&skuId=47131811&storeId=609&zipCode=98101&_gl=

          10. Add to Registry
              https://www.bedbathandbeyond.com/store/account/Login?type=registry&qty=1&skuId=47132412

          11. Notify Me
              https://www.bedbathandbeyond.com/store/product/wamsutta-reg-pima-500-thread-count-sheet-set/3310408?type=notifyMe&sku=47132146

          12. Write a Review
              https://www.bedbathandbeyond.com/store/product/wamsutta-reg-pima-500-thread-count-sheet-set/3310408?writeReview=true

        Test Suite 4 - Canonical only, PWA does not handle personalization.
        PDP Personalize Test Page: https://www-bedbathandbeyond-com.cdn.ampproject.org/c/s/www.bedbathandbeyond.com/amp/store/product/classic-stripe-personalized-beach-towel/5030502

          13. Personalize
              https://www.bedbathandbeyond.com/store/product/classic-stripe-personalized-beach-towel/5030502?type=personalize&qty=1&skuId=63871623&storeId=609&zipCode=98101&_gl=

        Test Suite 5 - Canonical only, PWA does not handle protection plan.
        PDP Protection Plan Test Page: https://www.bedbathandbeyond.com/amp/store/product/powerxl-vortex-7-qt-airfryer-trade/5382047?skuId=68531102

          14. https://www.bedbathandbeyond.com/store/product/powerxl-vortex-7-qt-airfryer-trade/5382047?type=protectionPlan&skuId=68531102

  * @param {URL} urlObj - url object for current request.
  * @returns {[URL, boolean]}
  *   - url object with interaction parameters removed.
  *   - Whether the interaction was handled
  *   - Params will only be cleared if stopNav is set to true on the interaction object
  *     and an there is a matching interaction found
  */

  async interactionParamRouter(urlObj) {
    const params = urlObj.searchParams;
    let isHandled = false;
    let clearParams = false;
    // Find the correct handler
    for (const interaction of this.interactions) {
      if (!params.has(interaction.paramKey)) {
        continue;
      } else if (
        interaction.paramVal &&
        interaction.paramVal !== params.get(interaction.paramKey)
      ) {
        continue;
      } else {
        /* convert url parameters into regular object so we
        can reuse interaction handlers in other parts of PWA. */
        const params = {};
        for (let [key, value] of urlObj.searchParams.entries()) {
          params[key] = value;
        }
        interaction.handler.bind(interaction.thisArg)(
          params,
          interaction.paramVal,
          urlObj
        );
        isHandled = interaction.stopNav;
        clearParams = !interaction.doNotClearParams ? true : false;
        break;
      }
    }

    // Clear interaction parameters from url
    if (!this.pwa.session.isStaging && clearParams) {
      for (const param of this.interactionParamsToClear) {
        urlObj.searchParams.delete(param);
      }
      history.replaceState(null, "", urlObj.href);
    }

    // Hash-based nav/interactions handled in ampPostRender
    // ex: https://em02-www.bbbyapp.com/store/product/gourmet-settings-promise-flatware-collection/211901?wmPwa&categoryId=10534#collections

    return [urlObj, isHandled];
  }

  /**
   * Progressive enhancements that should be performed after
   * First contentful paint.
   */
  async loadFirstPagePostRender() {
    try {
      // Remove Appshell header placeholder
      $("#headerWrap").remove();

      // load cart sticky
      if (window.innerWidth >= 768) this.pwa.appshell.renderCartSticky(false);
      console.timeEnd("pwaFirstPageRender");
      await this.scriptsFirstPagePostRender();
    } catch (ex) {
      this.pwa.errorCustom(ex);
    }
  }

  /**
   * Load service worker on first scroll
   * BBB servce worker is 19MB !
   */
  async loadFirstPageFirstScrollOrClick() {
    // make sure we do not call twice
    if (wmPwa.session.loadedFirstPageFirstScrollOrClick) return;
    wmPwa.session.loadedFirstPageFirstScrollOrClick = true;
    $(window).off("scroll", wmPwa.site.loadFirstPageFirstScrollOrClick);
    $(window).off("mousedown", wmPwa.site.loadFirstPageFirstScrollOrClick);

    // Quantum Metric after 1 seconds
    setTimeout(async () => {
      // load quantum script, from Ronak 10/19/20
      let quantumScriptURL =
        "https://cdn.quantummetric.com/qscripts/quantum-bbb.js";
      if (wmPwa.session.isPreprod) {
        quantumScriptURL =
          "https://cdn.quantummetric.com/qscripts/quantum-bbbtest.js";
      }
      let quantumScript = document.createElement("script");
      quantumScript.setAttribute("defer", "");
      quantumScript.setAttribute("src", quantumScriptURL);
      document.head.appendChild(quantumScript);
    }, 1000);

    // Service worker after 6 seconds - 18MB in assets - Yikes!
    setTimeout(async () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .register("/sw.js")
          .then(function (registration) {
            console.log("Service Worker Registered", registration);
          })
          .catch(function (err) {
            console.log("Service Worker Failed to Register", err);
          });
      }
    }, 6000);
  }

  /**
   * Scrapes a product id from a pdp url.
   * @param {URL} urlObj - url to evaluate
   * @returns {String} - Product ID from end of Url.
   */
  prodIdGet(urlObj) {
    let prodId = null;
    let prodIdMatch = /(\d+)(\/)?$/i.exec(urlObj.pathname);
    if (prodIdMatch) prodId = prodIdMatch[1];
    return prodId;
  }

  /**
   * Session storage item to help react application remember user's last page.
   * Should be called after every URL change. eg. pageload and plp facet application.
   */
  redirectUrlSet() {
    try {
      sessionStorage.setItem(
        "redirectpageurl",
        `${location.pathname}${location.search}`
      );
    } catch (e) {}
  }

  /**
   * Returns sku details if the current skuFacets object matches a sku
   * @param {obj} prodSkusAll - page load product-sku api response
   * @param {obj} skuFacets - page load / user set product facets
   * @param {boolean} colorOnly - match the first sku that has a color match
   */
  skuGet(prodSkusAll, skuFacets, colorOnly) {
    if (!prodSkusAll || !prodSkusAll.data) return null;

    colorOnly = colorOnly || false;
    /* For multifacet products */
    function prodSkuByColorAndSize(prodSkusAll, skuFacets) {
      let sku = prodSkusAll.data.filter(
        (sku) => sku.COLOR == skuFacets.color && sku.SKU_SIZE == skuFacets.size
      )[0];
      return sku || null;
    }
    /* For single-facet products */
    function prodSkuByColorOrSize(prodSkusAll, skuFacets) {
      let sku = prodSkusAll.data.filter(
        (sku) =>
          (skuFacets.color && skuFacets.color == sku.COLOR) ||
          (skuFacets.size && skuFacets.size == sku.SKU_SIZE)
      )[0];
      return sku || null;
    }
    /* For single-facet products */
    function prodSkuByColor(prodSkusAll, skuFacets) {
      let sku = prodSkusAll.data.filter(
        (sku) => skuFacets.color && skuFacets.color == sku.COLOR
      )[0];
      return sku || null;
    }

    let sku;
    if (skuFacets.qty == 2 && colorOnly)
      sku = prodSkuByColor(prodSkusAll, skuFacets);
    else if (skuFacets.qty == 2)
      sku = prodSkuByColorAndSize(prodSkusAll, skuFacets);
    else if (skuFacets.qty == 1)
      sku = prodSkuByColorOrSize(prodSkusAll, skuFacets);
    return sku;
  }

  /**
   * Load 3rd party scripts into the AppShell on every page load
   *
   * @returns {Promise} -> undefined
   */
  async scriptsEveryPagePostRender() {
    // console.log("adding scripts on every page load");

    this.pwa.site.redirectUrlSet();

    if (this.pwa.session.isFast) return;
    this.pwa.appshell.renderTemplate(
      "#scriptsEveryPageDom",
      "#scriptsEveryPageTemplate"
    );

    // load page specific tealium script
    // load the BBB tealium integration script, this is page type dependent
    var pageTypeAnalayticsURL;
    var pageTypeAnalayticsId;
    if (this.pwa.session.docTests.isHomeReg.test(location.pathname)) {
      pageTypeAnalayticsURL = "/static/analytics/amp/event/homePwaAnalytics.js";
      pageTypeAnalayticsId = "homePwaAnalytics";
    } else if (this.pwa.session.docTests.isCLPReg.test(location.pathname)) {
      pageTypeAnalayticsURL = "/static/analytics/amp/event/clpPwaAnalytics.js";
      pageTypeAnalayticsId = "clpPwaAnalytics";
    } else if (this.pwa.session.docTests.isPLPReg.test(location.pathname)) {
      pageTypeAnalayticsURL = "/static/analytics/amp/event/plpPwaAnalytics.js";
      pageTypeAnalayticsId = "plpPwaAnalytics";

      // populate the product Ids for analytics
      try {
        let product_ids_displayed = [];
        let prodList = await this.pwa.amp.ampGetState("prodList");

        // PPS-3224 - on composite-listing API failure, change reported search term
        // from this.pwa.session.searchTemplateTerm to "apiFailure - {searchTerm}"
        if (prodList.errMsg == "Unable to get data for AMP.prodList") {
          const searchTermReg = new RegExp(
            this.pwa.session.searchTemplateTerm,
            "gi"
          );
          try {
            this.pwa.session.docObjActive.ampPathSearch =
              this.pwa.session.docObjActive.ampPathSearch.replace(
                searchTermReg,
                encodeURIComponent(
                  `apiFailure - {${
                    this.pwa.session.parsedURL.basePath.split("/")[3]
                  }}`
                )
              );
          } catch (e) {}
        }

        prodList.response.docs.forEach(function (e) {
          if (e.PRODUCT_ID) {
            product_ids_displayed.push(e.PRODUCT_ID);
          }
        });

        // use regex to replace the items currently in the datalayer string.
        // if we need to update/replace other datalayer items here, it will probably be better to parse it to an
        // object, update and then re-encode. But for now, just using regex
        // remove old product_id, if it exist
        this.pwa.session.docObjActive.ampPathSearch =
          this.pwa.session.docObjActive.ampPathSearch.replace(
            /%22product_id%22%3A%5B(.+)%5D%2C/,
            ""
          );
        // Make sure search results are up to date for tealium
        const numFound = (await this.pwa.amp.ampGetState("prodList")).response
          .numFound;
        this.pwa.session.docObjActive.ampPathSearch =
          this.pwa.session.docObjActive.ampPathSearch.replace(
            /search_results%22%3A[0-9]+/,
            `search_results%22%3A${numFound}`
          );
        // replace product_ids_displayed and product_id with new product_ids_displayed array
        let encodedString = encodeURIComponent(
          JSON.stringify(product_ids_displayed)
        );
        this.pwa.session.docObjActive.ampPathSearch =
          this.pwa.session.docObjActive.ampPathSearch.replace(
            /%22product_ids_displayed%22%3A%5B(.+)%5D/,
            "%22product_ids_displayed%22:" +
              encodedString +
              "%2C%22product_id%22:" +
              encodedString
          );

        // add the search_id, required for GroupBy
        this.pwa.session.docObjActive.ampPathSearch +=
          "&groupBySearchId=" + prodList.id;

        // add flag for quickview
        if (this.pwa.quickView.quickViewLoaded) {
          this.pwa.session.docObjActive.ampPathSearch += "&quickview=true";
        }
      } catch (ex) {
        console.error("Could not populate the product Ids for analytics", ex);
      }
    } else if (this.pwa.session.docTests.isPDPReg.test(location.pathname)) {
      pageTypeAnalayticsURL = "/static/analytics/amp/event/pdpPwaAnalytics.js";
      pageTypeAnalayticsId = "pdpPwaAnalytics";
    }

    // load only of we have not already loaded this type
    if ($("#" + pageTypeAnalayticsId).length == 0) {
      let tealiumIntegration = document.createElement("script");
      tealiumIntegration.setAttribute("defer", "");
      tealiumIntegration.setAttribute("src", pageTypeAnalayticsURL);
      tealiumIntegration.setAttribute("id", pageTypeAnalayticsId);
      tealiumIntegration.onload = function () {
        // call the tealiumPageLoad function, this function is controll by BBB / Mehul's team
        if (
          window.triggerLoadEvent &&
          this.pwa.session.docObjActive.ampPathSearch
        ) {
          window.triggerLoadEvent(this.pwa.session.docObjActive.ampPathSearch);
        }
      }.bind(this);
      document.head.appendChild(tealiumIntegration);
    } else {
      if (
        window.triggerLoadEvent &&
        this.pwa.session.docObjActive.ampPathSearch
      ) {
        window.triggerLoadEvent(this.pwa.session.docObjActive.ampPathSearch);
      }
    }

    // Load mPulse script
    // https://developer.akamai.com/tools/boomerang#mpulse-non-blocking-loader-snippet
    // These API keys are exposed in the page so don't need to be kept secret
    let mPulseAPIKey = "5V36A-NLMZS-7YZAZ-HFM7A-9LEGR";
    if (this.pwa.session.isBABY) mPulseAPIKey = "QQ2TK-UWBEU-SEMVW-DA9FE-W7TV4";
    else if (this.pwa.session.isCANADA)
      mPulseAPIKey = "T4WGM-M63BR-D98MP-ULKLM-D3MUC";
    else if (this.pwa.session.isHARMON)
      mPulseAPIKey = "RWF6G-CAHF9-DFMD4-NSZLT-EUGT4";

    // Non-minified upper portion of script provided by Stephen Pierzchala at Akamai - spierzch@akamai.com
    // Lower minified portion comes from akamai docs above. See docs for non-minified version.
    let mPulseIntegration = $(
      `<script>
      window.BOOMR_config = window.BOOMR_config || {};
      window.BOOMR_config.AutoXHR = window.BOOMR_config.AutoXHR || {};
      window.BOOMR_config.AutoXHR = {
        // alwaysSendXhr: true,
        spaStartFromClick: true,
        monitorFetch: true
      };
      window.BOOMR_config.PageParams = {
        spaXhr: "all"
      };

      //
      // Resource Timing - Set Count to 350
      //
      (function(w){
        if (!w ||
          !("performance" in w) ||
          !w.performance ||
          !w.performance.setResourceTimingBufferSize) {
          return;
        }

        w.performance.setResourceTimingBufferSize(350);
      })(window);


      //
      //Clear Resource Timing Buffer
      //
      (function(w){
        if (!w ||
          !("performance" in w) ||
          !w.performance ||
          !w.performance.clearResourceTimings) {
          return;
        }

        document.addEventListener("onBoomerangBeacon", w.performance.clearResourceTimings.bind(w.performance));
      })(window);

      (function(){if(window.BOOMR&&(window.BOOMR.version||window.BOOMR.snippetExecuted)){return}window.BOOMR=window.BOOMR||{};window.BOOMR.snippetStart=(new Date).getTime();window.BOOMR.snippetExecuted=true;window.BOOMR.snippetVersion=15;window.BOOMR.url="//c.go-mpulse.net/boomerang/${mPulseAPIKey}";var e=document.currentScript||document.getElementsByTagName("script")[0],a=e.parentNode,s=false,t=3e3;function n(){if(s){return}var e=document.createElement("script");e.id="boomr-scr-as";e.src=window.BOOMR.url;e.async=true;a.appendChild(e);s=true}function i(e){s=true;var t,i=document,n,o,d,r=window;window.BOOMR.snippetMethod=e?"if":"i";n=function(e,t){var n=i.createElement("script");n.id=t||"boomr-if-as";n.src=window.BOOMR.url;BOOMR_lstart=(new Date).getTime();e=e||i.body;e.appendChild(n)};if(!window.addEventListener&&window.attachEvent&&navigator.userAgent.match(/MSIE [678]\./)){window.BOOMR.snippetMethod="s";n(a,"boomr-async");return}o=document.createElement("IFRAME");o.src="about:blank";o.title="";o.role="presentation";o.loading="eager";d=(o.frameElement||o).style;d.width=0;d.height=0;d.border=0;d.display="none";a.appendChild(o);try{r=o.contentWindow;i=r.document.open()}catch(e){t=document.domain;o.src="javascript:var d=document.open();d.domain='"+t+"';void 0;";r=o.contentWindow;i=r.document.open()}r._boomrl=function(){n()};if(r.addEventListener){r.addEventListener("load",r._boomrl,false)}else if(r.attachEvent){r.attachEvent("onload",r._boomrl)}i.close()}var o=document.createElement("link");if(o.relList&&typeof o.relList.supports==="function"&&o.relList.supports("preload")&&"as"in o){window.BOOMR.snippetMethod="p";o.href=window.BOOMR.url;o.rel="preload";o.as="script";o.addEventListener("load",n);o.addEventListener("error",function(){i(true)});setTimeout(function(){if(!s){i(true)}},t);BOOMR_lstart=(new Date).getTime();a.appendChild(o)}else{i(false)}function d(e){window.BOOMR_onload=e&&e.timeStamp||(new Date).getTime()}if(window.addEventListener){window.addEventListener("load",d,false)}else if(window.attachEvent){window.attachEvent("onload",d)}})();
    </script>
    `
    );
    // mPulse docs want it at top of HEAD but after META tags
    /* 
      added as part of https://bedbathandbeyond.atlassian.net/browse/PP-3507
      to troubleshoot TTI increasing right when mPulse was implemented
    */
    if (!/mPulse=false/gi.test(location.search))
      $("head meta").last().after(mPulseIntegration);

    // render webcollage, only if PDP, on scroll
    if (
      this.pwa.session.docTests.isPDPReg.test(location.pathname) &&
      !this.pwa.session.isFast
    ) {
      let loadWebCollageScript = this.pwa.util
        .debounce(function () {
          document.removeEventListener("scroll", loadWebCollageScript);

          // load the web collage script, if it is not already loaded in the appshell
          if ($("#webcollageClientScript").length == 0) {
            // this is the OLD script
            // let webcollageScriptURL =
            //   "https://scontent.webcollage.net/api/v2/product-content";

            // this is the new script. Instructions here, password (betadocs2020): https://developer.syndigo.com/docs/implementing-the-synditag
            // Harmon does not have a syndigo id for now
            let siteID = "7bd96439-1976-4748-9c97-242941e50e0d";
            if (this.pwa.session.isBBB_US && this.pwa.desktop.isDesktop) {
              siteID = "52539da6-b43e-469f-927f-294e7b3435bd";
            }
            if (this.pwa.session.isBABY) {
              siteID = "1cb29f4c-1651-46ef-b519-7c9a991a0e94";
              if (this.pwa.desktop.isDesktop) {
                siteID = "9ccdeb66-058d-48f9-88fb-9e1e83844981";
              }
            }
            if (this.pwa.session.isCANADA) {
              siteID = "0697092a-f6c4-4719-afb8-0a8853fc44bb";
              if (this.pwa.desktop.isDesktop) {
                siteID = "f46b6882-cb52-446c-bd0d-172a3dc3e979";
              }
            }

            let webcollageScriptURL =
              "https://content.syndigo.com/site/" +
              siteID +
              "/tag.js?cv=" +
              Math.floor(Date.now() / 86400000);
            let webcollageScript = document.createElement("script");
            webcollageScript.setAttribute("async", "");
            webcollageScript.setAttribute("src", webcollageScriptURL);
            webcollageScript.setAttribute("id", "webcollageClientScript");

            this.pwa.site.renderWebcollage();
            document.head.appendChild(webcollageScript);
          } else {
            // render the Webcollage message
            this.pwa.site.renderWebcollage();
          }
        })
        .bind(this);

      document.addEventListener("scroll", loadWebCollageScript);
    }
  }

  /**
   * Load 3rd party scripts into the AppShell after first page load
   *
   * @returns {Promise} -> undefined
   */
  async scriptsFirstPagePostRender() {
    // console.log("adding scripts after first document load");

    if (this.pwa.session.isFast) return;
    this.pwa.appshell.renderTemplate(
      "#scriptsFirstPageDom",
      "#scriptsFirstPageTemplate"
    );

    // load the main Tealium script, and the main /static/analytics/amp/event/pwaAnalytics.js
    let loadTealium = new Promise((resolve, reject) => {
      var tealiumScriptURL;
      if (
        location.host === "www.bedbathandbeyond.com" ||
        location.host === "www.harmonfacevalues.com" ||
        location.host === "www.buybuybaby.com" ||
        location.host === "www.bedbathandbeyond.ca" ||
        location.host === "blog.bedbathandbeyond.com" ||
        (location.host.indexOf("bbbyproperties") > -1 &&
          location.host.indexOf("bbbypropertiestest") < 0)
      ) {
        tealiumScriptURL =
          "https://tags.tiqcdn.com/utag/bbb/bbb-feo/prod/utag.js";
      } else {
        tealiumScriptURL =
          "https://tags.tiqcdn.com/utag/bbb/bbb-feo/qa/utag.js";
      }

      let tealiumScript = document.createElement("script");
      tealiumScript.setAttribute("defer", "");
      tealiumScript.setAttribute("src", tealiumScriptURL);
      tealiumScript.onload = function () {
        // load the BBB tealium integration script, this is for all pages

        let tealiumIntegration = document.createElement("script");
        tealiumIntegration.setAttribute("defer", "");
        tealiumIntegration.setAttribute(
          "src",
          "/static/analytics/amp/event/pwaAnalytics.js"
        );
        tealiumIntegration.setAttribute("id", "pwaAnalyticsScript");
        tealiumIntegration.onload = function () {
          // Q: do we need to call anything here?
          resolve();
        };
        document.head.appendChild(tealiumIntegration);
      };
      document.head.appendChild(tealiumScript);
    });

    // // load some scripts after a touch or scroll
    // const lazyLoadScriptsAfterInteraction = () => {
    //   // make sure we did not already call this
    //   if (this.pwa.session.lazyLoadedScriptsAfterInteraction) return;
    //   this.pwa.session.lazyLoadedScriptsAfterInteraction = true;

    //   // remove event handlers, so we only call this once
    //   wmPwa.session.docObjActive.hostElem.removeEventListener(
    //     "click",
    //     lazyLoadScriptsAfterInteraction
    //   );
    //   wmPwa.session.docObjActive.hostElem.parentElement.removeEventListener(
    //     "scroll",
    //     lazyLoadScriptsAfterInteraction
    //   );

    //   // load quantum script, from Ronak 10/19/20
    //   let quantumScriptURL =
    //     "https://cdn.quantummetric.com/qscripts/quantum-bbb.js";
    //   if (wmPwa.session.isPreprod) {
    //     quantumScriptURL =
    //       "https://cdn.quantummetric.com/qscripts/quantum-bbbtest.js";
    //   }
    //   let quantumScript = document.createElement("script");
    //   quantumScript.setAttribute("defer", "");
    //   quantumScript.setAttribute("src", quantumScriptURL);
    //   document.head.appendChild(quantumScript);
    // };

    // this.pwa.session.docObjActive.hostElem.addEventListener(
    //   "click",
    //   lazyLoadScriptsAfterInteraction
    // );
    // this.pwa.session.docObjActive.hostElem.parentElement.addEventListener(
    //   "scroll",
    //   lazyLoadScriptsAfterInteraction
    // );

    await Promise.all([loadTealium]);

    $(window).on("scroll", wmPwa.site.loadFirstPageFirstScrollOrClick);
    $(window).on("mousedown", wmPwa.site.loadFirstPageFirstScrollOrClick);

    this.scriptsEveryPagePostRender();
  }

  /**
   * Returns the full URL with the facets (both friendly and encoded)
   */
  async getFacetURL() {
    const url = new URL(location.href);
    const facetSegments = [];
    let basePLPPath = this.pwa.session.parsedURL.basePath;

    // fetch selected facets
    const [apiUrl, changeStore] = await Promise.all([
      this.pwa.amp.ampGetState("apiUrl"),
      this.pwa.amp.ampGetState("changeStore"),
    ]);

    /** Pathname Segments - order matters here. **/

    // Facet Filters
    // convert our facet object to BBB style facet object
    let selectedFacets = this.facetsRemoveDoubleQuotes(apiUrl.facets);
    // calc encoded portion of URL
    let encodedSegment = this.stringifyFacets(selectedFacets);
    // calc friendly portion of URL
    let friendlySegment = this.buildFriendlyFacetUrlSegment(
      this.facetsToKebabCase(selectedFacets)
    );

    // 1. Search term - from facet sidebar, not Search url.
    // apiUrl.searchTerms has already ben run through encodeURIComponent
    if (apiUrl.searchTerms)
      facetSegments.push(
        `fl_${encodeURI(apiUrl.searchTerms).replace(/%20/gi, "-")}`
      );

    // 2. Friendly Facet segment
    if (friendlySegment) facetSegments.push(friendlySegment);

    // 3. Pagination
    if (apiUrl.page >= 1)
      facetSegments.push(`${apiUrl.page + 1}-${apiUrl.perPage || 24}`);

    // 4a. BOPIS - "Free 2 hour pickup" checkbox
    const bopisSegmentMatch = /&storeOnlyProducts=true&storeId=(\d+)/i.exec(
      apiUrl.storeOnlyParam
    );
    const bopisSegment = bopisSegmentMatch
      ? `store-${bopisSegmentMatch[1]}`
      : "";
    if (bopisSegment) facetSegments.push(bopisSegment);

    // 4b. SDD - "Same Day Delivery" checked
    const sddZip = /sddZip=([0-9a-z]{3,5})/i.exec(apiUrl.sddZipParam);
    const sddSegment = sddZip ? `sddZip-${sddZip[1]}` : "";
    if (sddSegment) facetSegments.push(sddSegment);

    // 5. Encoded facet segment is always last
    if (encodedSegment) facetSegments.push(btoa(encodedSegment));

    /** Query Parameters **/

    // a. Sorting
    if (apiUrl.sort)
      url.searchParams.set("sort", apiUrl.sort.replace("&sort=", ""));
    else url.searchParams.delete("sort");

    // b. User has selected "In Stock Online" checkbox
    if (apiUrl.inStockOnline) url.searchParams.set("inStockOnline", true);
    else url.searchParams.delete("inStockOnline");

    // c. BOPIS and SDD both set removeInStock=true
    if (apiUrl.removeInStock) url.searchParams.set("removeInStock", true);
    else url.searchParams.delete("removeInStock");

    // d. nearestStores - TODO
    if (changeStore.nearestStores)
      url.searchParams.set("nearestStores", changeStore.nearestStores);
    else url.searchParams.delete("nearestStores");

    // put whole URL together
    // some pages, like brands, do not have friendlySegment, this matches canonical
    /*
    https://bedbathandbeyond.atlassian.net/browse/PPS-6126
    React requires a %20 special character. However when you use the searchParams method on the URL class
    it adds %2520, which apparently is causing problems on React
    Convert [sort=LOW_PRICE%2520asc]
    to
    [sort=LOW_PRICE%20asc]
    */
    return (
      url.origin +
      basePLPPath.replace(/\/?$/, "/") +
      facetSegments.join("/") +
      url.search.replace(/%2520/gi, "%20") +
      url.hash
    );
  }

  /**
   * Returns womp style facet object
   */
  getAppliedFacetsFromBase64(base64Facets) {
    // decode base64
    let decodedFacets = atob(base64Facets);
    // parse it
    let appliedFacets = this.parseFacets(decodedFacets);
    // convert BBB format to AMP format
    appliedFacets = this.addFacetDoubleQuotes(appliedFacets);
    return appliedFacets;
  }

  /**
   * Returns and object with all the different URL parts
   */
  parseURL(urlObject) {
    // for now, just return base path and facets
    // facets should always be the last path
    // should probably add brand, L1, L2, L3, etc.
    // will definitely need to add SORT
    let partsObject = {
      basePath: "",
      bopis: null,
      facets: null,
      friendlyFacets: null,
      fullPath: urlObject.pathname,
      page: null,
      perPage: null,
      sddZipcode: null,
      searchTerms: null,
      storeId: null,
    };

    let parts = urlObject.pathname.split("/");
    let isUnfacetedSearch =
      this.pwa.session.docTests.isSearchReg.test(urlObject.pathname) &&
      parts.length == 4;
    let isUnfacetedBrand =
      this.pwa.session.docTests.isBrandReg.test(urlObject.pathname) &&
      parts.length == 5;
    let lastpart =
      isUnfacetedSearch || isUnfacetedBrand
        ? "doNotParse"
        : parts[parts.length - 1];

    parts.forEach((part, i) => {
      if (part) {
        // first, see if this could be a facet
        // is the last path, and it is base64?
        let isFacets = false;
        if (part == lastpart) {
          try {
            // For some reason the /store/vendor/vendorName/2011 passes the below atob() test
            window.atob(part);
            // XXX MCM TODO, parse the facets here, to make sure we have valid content.
            // For some reason the last path of vendor pages pass the above atob() test
            if (!/\/store\/vendor\/([a-zA-z]+)/i.test(partsObject.basePath))
              isFacets = true;
          } catch (ex) {}
        }

        if (partsObject.basePath == "/store/s" && i == 3) {
          // test if part is search term
          partsObject.basePath += "/" + part;
        } else if (/^fl_/i.test(part)) {
          // test for sws sidebar search: "Narrow Search Within Search"
          partsObject.searchTerms = decodeURI(
            part.replace("fl_", "").replace(/-/gi, "%20")
          );
        } else if (/^_[A-Za-z-0-9_-]+/.test(part)) {
          // test for friendly facets
          partsObject.friendlyFacets = part;
        } else if (/^\d+-\d+/i.test(part)) {
          // test for pagination
          const pageMatch = /^(\d+)-(\d+)/i.exec(part);
          // if present, page will always be 2 or higher
          partsObject.page = parseInt(pageMatch[1] - 1);
          partsObject.perPage = parseInt(pageMatch[2]);

          // PD-626: Do not allow user's to go past the max results
          if ((partsObject.page + 1) * partsObject.perPage > 9792) {
            partsObject.page = Math.floor(9792 / partsObject.perPage) - 1;
            partsObject.fullPath = partsObject.fullPath.replace(
              part,
              `${partsObject.page}-${partsObject.perPage}`
            );
          }
        } else if (/^store-\d+/i.test(part)) {
          // test for store
          const storeIdMatch = /^store-(\d+)/i.exec(part);
          partsObject.storeId = storeIdMatch[1];
        } else if (/^sddZip-([0-9]+)/i.test(part)) {
          // test for sdd
          const zipCodeMatch = /^sddZip-([0-9]+)/i.exec(part);
          partsObject.sddZipcode = zipCodeMatch[1];
        } else if (isFacets) {
          // test for facets, see if this is the last path, and it is base64
          partsObject.facets = part;
        } else {
          // append to base path
          partsObject.basePath += "/" + part;
        }
      }
    });

    // 7.6.21 Remove all trailing slashes
    // if this is NOT a search base page, then append trailing slash
    // partsObject.basePath += isUnfacetedSearch ? "" : "/";

    return partsObject;
  }

  /**
   * Converts AMP facet object to BBB format, so buildFriendlyFacetUrlSegment and stringifyFacets functions match their URLs
   */
  facetsToKebabCase(selectedFacets) {
    for (const facet in selectedFacets) {
      for (const value in selectedFacets[facet]) {
        selectedFacets[facet][value] = this.pwa.util.toKebabCase(
          selectedFacets[facet][value]
        );
      }
    }
    return selectedFacets;
  }

  facetsRemoveDoubleQuotes(selectedFacets) {
    // this will remove the double quotes, and remove any keys with null values.
    let toReturn = {};
    for (const facet in selectedFacets) {
      for (const value in selectedFacets[facet]) {
        if (selectedFacets[facet][value]) {
          if (!toReturn[facet]) {
            toReturn[facet] = [];
          }
          toReturn[facet].push(
            selectedFacets[facet][value]
              .replace(/^"|"$/g, "")
              .replace(/\\"/g, '"')
          );
          // toReturn[facet].push(selectedFacets[facet][value]);
        }
      }
    }
    return toReturn;
  }

  /**
   * Converts BBB facet object to AMP format, so AMP state works
   */
  addFacetDoubleQuotes(selectedFacets) {
    // return selectedFacets;
    const quoteDoubleEscaped = '\\"';
    const quoteDoubleReg = /"/gi;

    for (const facet in selectedFacets) {
      for (const value in selectedFacets[facet]) {
        // selectedFacets[facet][value] = '"' + selectedFacets[facet][value] + '"';
        selectedFacets[facet][value] =
          '"' +
          (selectedFacets[facet][value] || "").replace(
            quoteDoubleReg,
            quoteDoubleEscaped
          ) +
          '"';
      }
    }
    return selectedFacets;
  }

  /**
   * Assembles all of the "key" values of the selected facets
   * into a single string used for the "friendly facet" URL
   * segment (e.g. _black_red_cuisinart).
   *
   * @param {object} selectedFacets
   * @return {string}
   */
  buildFriendlyFacetUrlSegment(selectedFacets) {
    const excludedKeys = ["CATEGORY_HIERARCHY", "LOW_PRICE"];
    const glue = "_";
    const includedKeys = Object.keys(selectedFacets)
      .filter(
        (key) => !excludedKeys.includes(key) && selectedFacets[key].length
      )
      .sort();
    const result = includedKeys.length
      ? glue +
        includedKeys
          .map((key) =>
            selectedFacets[key]
              .map((v) =>
                key === "RATINGS" && v.match(/(\d+)[.-]0/)
                  ? v.match(/(\d+)[.-]0/)[1]
                  : v
              )
              .sort()
              .join(glue)
          )
          .join(glue)
      : null;
    return result;
  }

  /**
   * Takes a facet data object, transforms it into a serialized, sorted string
   *
   * Example input: {LOW_PRICE:["0-25.99"],RATINGS:["5","4"]}
   * Example output: LOW_PRICE:"[0,25.99]"||RATINGS:"5"|"4"
   *
   * @param {object} obj
   * @return {string}
   */
  stringifyFacets(obj) {
    const final = [];
    const keys = Object.keys(obj).sort();
    keys.forEach((key) => {
      const value = obj[key]
        .map((v) =>
          key === this.PRICE_KEY && v !== "" ? `"[${v.split("-")}]"` : `"${v}"`
        )
        .sort()
        .join(this.VALUE_DELIMITER);
      final.push(`${key}${this.PAIR_DELIMITER}${value}`);
    });
    return final.join(this.GROUP_DELIMITER);
  }

  /**
   * Takes a serialized string and returns a facet data object
   *
   * Example input: LOW_PRICE:"[0,25.99]"||RATINGS:"5"|"4"
   * Example output: {LOW_PRICE:["0-25.99"],RATINGS:["5","4"]}
   *
   * @param {string} str
   * @return {object}
   */
  parseFacets(str) {
    try {
      return (
        str &&
        str
          .split(this.GROUP_DELIMITER)
          .map((val) =>
            val.indexOf(this.PAIR_DELIMITER) > -1
              ? [
                  val.substring(0, val.indexOf(this.PAIR_DELIMITER)),
                  val.substr(val.indexOf(this.PAIR_DELIMITER) + 1),
                ]
              : [val]
          )
          .map(([key, val]) => [key, val.split(this.VALUE_DELIMITER)])
          .reduce(
            (accum, [key, val]) => ({
              ...accum,
              [key]: this.reviver(key, val),
            }),
            {}
          )
      );
    } catch (error) {
      return { error };
    }
  }

  /**
   * Reviver for JSON.parse() used on segments of the facet data
   *
   * @param {string|number} key
   * @param {*} value
   * @return {*}
   */
  reviver(key, value) {
    switch (key) {
      case this.RATING_KEY:
        // get the number strings out
        return String(value).match(this.NUMBER_REG_EXP);
      case this.PRICE_KEY:
        // from ["[0-24.99]"] to ["0-24.99"]
        return value.map((val) =>
          val.match(this.NUMBER_REG_EXP).join(this.RANGE_DELIMITER)
        );
      default:
        break;
    }
    return value.map((v) => v.replace(this.STRIP_BOUNDING_QUOTES, ""));
  }

  /**
   * Store the most recently viewed products in localStorage.
   * Can be called on page load or form submission during transition.
   *
   * @param {URL} urlObj - URL that user is navigating to.
   */
  recentlyViewedDataUpdate(urlObj) {
    // Current Product
    let recentProd = urlObj.pathname.split("/").pop();
    if (!recentProd) return;
    let prodArr = [recentProd.replace(/-/, " ")];

    // Previous searches
    let prevProdString;
    try {
      prevProdString = localStorage.getItem("recentlyViewed");
    } catch (e) {}
    if (prevProdString) {
      const prevProdArr = prevProdString.split(",");
      prodArr = prodArr.concat(prevProdArr);
    }

    // Store 5 most recent unique searches
    prodArr = [...new Set(prodArr)];
    try {
      localStorage.setItem("recentlyViewed", prodArr.slice(0, 5).join(","));
    } catch (e) {}
  }

  /**
   * Clear recent Searches.
   */
  recentSearchClear() {
    try {
      localStorage.removeItem("recentsearchList");
    } catch (e) {}
    let ampBody = $(this.pwa.session.docObjActive.shadowBody);
    ampBody.find(".recentSearches, .recentSearchLink").remove();

    const cleanState = {
      recentSearches: null,
    };
    if (window.innerWidth >= 768) {
      cleanState.u = { search: null };
    }
    this.pwa.amp.ampsSetState(cleanState);
  }

  /**
   * Store the most recent search in document amp-state and localStorage.
   * Can be called at two different points in load cycle:
   *   Most pages - ampBeforeRender - update amp-state before render
   *   /store/s/search pages - ampListPostRender - update after search title
   *      amp-list render so we can add sanitized composite-listing search
   *      term property to recent searches.
   *
   * @param {CashJsCollection} doc$ - jQuery like document (provide for all non-search pages)
   */
  async recentSearchDataUpdate(doc$) {
    let searchArr = [];

    // If no body, we are calling this from ampListPostRender on /store/s/search-term page
    if (!doc$) {
      let [prodList, prevRecentSearchesState] = await Promise.all([
        // PLP prod list - Current Search or skip
        this.pwa.session.docTests.isPLPReg.test(location.pathname)
          ? this.pwa.amp.ampGetState("prodList", 300)
          : Promise.resolve(),
        // either empty or initialized by this function earlier
        this.pwa.amp.ampGetState("recentSearches", 300),
      ]);

      // If we already ran this function, return.
      // JW - this is for when a user lands on a search page and then applies filters,
      // causing the PLP title to re-render again on same search term.
      let recentSearchesArr =
        prevRecentSearchesState && prevRecentSearchesState.searches;
      if (recentSearchesArr) return;

      // add search term if we are landing on a search page
      let recentSearch;
      try {
        recentSearch = prodList.response.numFound && prodList.fusion.q;
        if (recentSearch) searchArr.push(recentSearch);
      } catch (ex) {
        // console.log("difficulty getting recent search term");
      }
    }

    // Previous searches
    let prevSearchString;
    try {
      prevSearchString = localStorage.getItem("recentsearchList");
    } catch (e) {}
    if (prevSearchString) {
      searchArr = searchArr.concat(prevSearchString.split(","));
    }
    if (!searchArr.length) return;

    // Store 5 most recent unique searches
    searchArr = [...new Set(searchArr)];
    try {
      localStorage.setItem("recentsearchList", searchArr.slice(0, 4).join(","));
    } catch (e) {}

    // Create amp-list compatible object
    const recentSearchState = searchArr.map((term) => {
      return {
        searchTerm: term,
        searchTermPath: term.replace(/[^a-zA-Z0-9]+/gi, "-"),
      };
    });

    // Update amp-state so that we can see recent searches in the template.
    if (doc$) {
      // every page except Search - Set before render to avoid premature setState and layout shift
      this.pwa.amp.ampSetStateBeforeRender(doc$, "recentSearches", null);
      this.pwa.amp.ampSetStateBeforeRender(doc$, "recentSearches", {
        searches: recentSearchState,
      });
    } else {
      // Search pages - set after render so we can use API response terms.
      this.pwa.amp.ampsSetState({ recentSearches: null });
      this.pwa.amp.ampsSetState({
        recentSearches: {
          searches: recentSearchState,
        },
      });
    }
  }

  /**
   * Records recent searches in local storage on form submission.
   * @param {}
   * @returns {boolean} - Whether this form was fully handled.
   *  false - AMP framework should also handle form.
   *  true - PWA has fully handled form.
   */
  recentSearchFormHandler(form) {
    const action = form.attr("action");
    let searchTerm = form.find("#searchInput").val();

    // added as part of CX-1233 when a user uses arrow keys to select their search term and hits enter
    // check sayt class for arrow event handler
    if (this.pwa.sayt.lastKeySearchTerm) {
      searchTerm = this.pwa.sayt.lastKeySearchTerm;
    }

    this.pwa.session.lastSearchTerm = searchTerm;
    if (!searchTerm) return false;
    searchTerm = searchTerm
      .trim()
      .replace(/"/gi, "_")
      .replace(/[^a-zA-Z0-9\"\'\:\$\&_]+|\s/gi, "-");

    let searchHref = `${action}${encodeURI(searchTerm)}`;

    // part of users navigate with arrow keys, handles brands and categories link
    // only happens if user hasnt used one of the mouseover events
    if (
      this.pwa.sayt.aSelect &&
      this.pwa.sayt.aSelect[0].dataset.link &&
      this.pwa.sayt.lastKeySearchTerm != this.pwa.sayt.term
    ) {
      searchHref = this.pwa.sayt.aSelect.attr("href");
    }

    this.pwa.load(searchHref);

    // prevent amp framework from navigating due to form submission.
    return true;
  }

  async siteGiftcardHandler(form) {
    let auth = await this.pwa.user.sessionConfirmationHeadersGetOrSet();
    let resData;
    const matchHandler = this.pwa.util.createInputMatchHandler({
      useForm: true,
    });
    // let formType = form.getAttribute("data-form-type");
    let valid = this.pwa.appshell.validateForm(form[0]);
    let match = matchHandler(form);
    if (!valid || !match) {
      this.formValidationHandler = this.formValidationHandler
        ? this.formValidationHandler
        : (e) => {
            this.pwa.appshell.validateForm(e.currentTarget);
          };
      $(form).addClass("amp-form-submit-error");
      form[0].removeEventListener("change", this.formValidationHandler);
      form[0].addEventListener("change", this.formValidationHandler);
      return;
    } else {
      $(form).removeClass("amp-form-submit-error");
    }
    const queryParams = $(form).serialize();
    try {
      const res = await fetch(this.pwa.session.apiInfo.apiGiftCardForm, {
        body: queryParams,
        param: { cardType: "RC" },
        credentials: "include",
        method: "POST",
        headers: Object.assign(
          {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          auth
        ),
      });
      resData = await res.json();
      const status = resData.serviceStatus;
      if (status == "SUCCESS") {
        $(form)
          .closest(".modalContentInner")
          .find("#giftCardBalanceAlert")
          .addClass("wHide");
        resData.data.component.balanceBean.giftCardIdShort =
          resData.data.component.balanceBean.giftCardId.slice(-4);
        this.pwa.amp.ampsSetState({ giftCard: resData });
      } else {
        let errorMsg = "";
        let rewErroMsg = "";
        if (
          (resData.data && resData.data.component.balanceBean.errorMessage) ||
          resData.errorMessages
        ) {
          errorMsg = resData.data.component.balanceBean.errorMessage;
          rewErroMsg = resData.errorMessages[0].message;
        } else {
          errorMsg =
            "The card is not active. Please enter another card or provide another form of payment for the balance.";
          rewErroMsg =
            "Rewards Certificate Error: The card is not active. Please enter another card or provide another form of payment for the balance.";
        }
        $(form)
          .closest(".modalContentInner")
          .find("#giftCardBalanceAlert")
          .removeClass("wHide")
          .text(errorMsg);
        $(form)
          .closest(".modalContentInner")
          .find("#rewardCardBalanceAlert")
          .removeClass("wHide")
          .text(rewErroMsg);
        throw new Error("Errors submitting gift card balance form", resData);
      }
    } catch (e) {
      $(form).addClass("amp-form-submit-error");
      console.warn(`Problem submitting gift card balance form. Error: ${e}`);
    }
    return;
  }

  async getPDPCurrentPrice() {
    // read from dom
    const ampBody = $(
      (this.pwa.session.docs.pdp || this.pwa.session.docObjActive).shadowBody
    );
    let currentPrice = 0;

    let isCollection = ampBody.find("#collections").length;
    //if (isCollection) return 0;

    let priceString = ampBody
      .find(
        ".pricesWrap amp-list:not([hidden]) div:not([class='amp-hidden'])>.trackIsPrice"
      )
      .text();

    // get the first price
    priceString = priceString.split("-")[0];

    currentPrice = Number(priceString.replace(/[^0-9.-]+/g, ""));

    return currentPrice;
  }

  /**
   * Sets up defaults for payment options
   * Sets up listeners for payment options
   * this should only be ran once on PDP Load
   */
  async activatePaymentOptions(ampBody$) {
    if (this.pwa.session.paymentInit) return;
    let contId = this.pwa.session.features.pdpCollectionsV2
      ? ".payOption2"
      : "#payOption2";
    // check price, to see what we have to load
    const session = this.pwa.session;

    // paypal is not shown by default
    session.paypalIsHidden = true;

    // no price is set yet
    session.currentPrice = -1;

    // update the price labels
    // This gets called too many times, but if we remove it the flags for rendering klarna and afterpay are not set
    await this.updatePaymentOptionPriceLabels();

    /*
      For pdpv21 this will not exist, which should be fine
      Remove after pdpv21 is stable
    **/
    // TODO - what does this comment refer to?

    // listen for clicks on "show more"
    if (this.pwa.session.features.pdpShowShowMorePaymentsLink) {
      ampBody$.find(`div${contId} div.moreOptions`).on("click", async () => {
        this.pwa.site.showMorePaymentOptions(ampBody$, contId);
      });
    } else {
      // show all now
      this.pwa.site.showMorePaymentOptions(ampBody$, contId);
    }
    this.pwa.session.paymentInit = true;
  }

  async paymentOptionClick(e$) {
    let ampBody$ = e$.closest("body");
    // listen for clicks on Klarna and AfterPay 'i' icons

    if (e$.is(".afterPayInfoIcon")) {
      this.pwa.util.scriptAdd(
        "https://js.afterpay.com/afterpay-1.x.js",
        "afterpayClientScript",
        function () {
          // change theme for canada
          let theme = "en_US-theme-white";
          if (/bbbycaapp|bedbathandbeyond\.ca/.test(location.host)) {
            theme = "en_CA-theme-white";
          }
          Afterpay.launchModal(theme);
        }
      );
    } else {
      // Klarna payment method
      ampBody$.find(".klarnaModalWrapper").addClass("active");
      return false;
    }
  }

  async renderKlarnaModal(ampBody$, currentPrice) {
    if (currentPrice < 10) return;
    let clientID = "";
    let klarnaDomain = "";

    if (this.pwa.session.isPreprod) {
      clientID = "99107726-80f4-5b15-96c5-0fbe32f883f8"; // US preprod
      if (this.pwa.session.isBABY) {
        clientID = "82a5e296-405a-504b-bc4c-8f4a712a74ee"; // baby preprod
      }
      klarnaDomain = "osm-na.playground.klarnaservices.com";
    } else {
      clientID = "8f0d53e7-b55a-54d5-815b-34d750247c28"; // US prod
      if (this.pwa.session.isBABY) {
        clientID = "62286914-4471-599f-806c-df66b3dde576"; // baby prod
      }
      klarnaDomain = "osm-na.klarnaservices.com";
    }

    let klarnaURL = `https://${klarnaDomain}/v3/messaging?client_id=${clientID}&placement_key=credit-promotion-badge&channel=web&locale=en-US&purchase_amount=${Math.round(
      currentPrice * 100
    )}`;
    try {
      await fetch(klarnaURL)
        .then((response) => response.json())
        .then((data) => {
          let modalURL = data.content.nodes[1].url;

          const klarnaMessage = $(".klarnaModalWrapper");
          if (klarnaMessage.length == 0) {
            ampBody$.append(
              `
              <div class="modal klarnaModalWrapper" data-modal-close>
                <div class="parent d6 modalContent">
                <!-- arbitrary H and W on iframe -->
                  <iframe
                    height="1200"
                    width="1200"
                    src="${modalURL}"
                  >
                  </iframe>
                  <button id="klarnaModalClose"
                    class="btn modalClose"
                    data-modal-close=""
                  >
                  <svg class="wi wiClose noTap"><use xlink:href="#wiClose"></use></svg>
                  </button>
                </div>
              </div>
              `
            );

            ampBody$
              .find("#klarnaModalClose, .klarnaModalWrapper")
              .on("click", (e) => {
                e.target
                  .closest(".klarnaModalWrapper")
                  .classList.remove("active");
              });
          } else {
            $(".klarnaModalWrapper iframe")
              .attr("src", modalURL)
              .addClass("active");
          }

          // fire klarna analytics
          fetch(data.impression_url, { mode: "no-cors" });
        });
    } catch (err) {
      console.error(err);
      debugger;
    }
  }

  async showMorePaymentOptions(ampBody$, contId) {
    const session = this.pwa.session;

    // show all options
    if (session.showPayPal) {
      ampBody$.find(`div${contId} div.paypal`).show();
      // render paypal! :'(
      // load the paypal script, if it is not already loaded
      session.paypalIsHidden = false;
      let paypalClientId = "";
      // force an update
      session.currentPrice = -1;

      if (session.isPreprod) {
        paypalClientId =
          "AXO-SBUsQQtEyKIO4u3Ihj9GEXfMnJjOgkVl8fwPJwYTjOYz0nw1LmDj_CDSPpEQMRvq8I1d2TyE7TZs";
      } else if (session.isBABY) {
        paypalClientId =
          "AQVhaTnL5pyyXwnn4D8pGfZIpSASJ3hvCfE04-2t-oZ5bxG0Br08c1v609avdfOd8M1jTGaAMZCu-MLa";
      } else {
        // Prod US and Canada
        paypalClientId =
          "AdfXyxI-oHYghKou93lC4LRkRB0OP3-8h0L5srBeDzUYFwJ44_Jk4Vv71CKt3BlMUlGUGseBIoRFAu0F";
      }

      this.pwa.util.scriptAdd(
        "https://www.paypal.com/sdk/js?client-id=" +
          paypalClientId +
          "&currency=USD&disable-funding=card&intent=order&commit=false&components=buttons,messages",
        "paypalClientScript",
        this.updatePaymentOptionPriceLabels.bind(this)
      );
    }

    if (session.showAfterPayAndKlarna) {
      let currentPrice = await this.pwa.site.getPDPCurrentPrice();
      if (this.pwa.session.features.pdpKlarna) {
        this.pwa.site.renderKlarnaModal(ampBody$, currentPrice);
      }
    }
    if (this.pwa.session.features.pdpShowShowMorePaymentsLink) {
      ampBody$.find(`div${contId} div.moreOptions`).hide();
      ampBody$.find(`div${contId}`).css({ height: "auto" });
    }
  }

  /**
   *
   * @param {CashJS Document} list$ - fullfillment amp list
   * @returns {Boolean} - success
   */
  async showHideKlarna(ampBody$) {
    let prodSku = await this.pwa.pdpDataAbstraction.getSkuDetails();
    if (prodSku) {
      if (prodSku.isPreorder || prodSku.isBackorder) {
        ampBody$.find(".paymentOption.klarna").hide();
        ampBody$.find(".payOption").css("min-height", "unset");
        return true;
      } else {
        ampBody$.find(".paymentOption.klarna").show();
      }
    }
    return false;
  }

  async updatePaymentOptionPriceLabels() {
    try {
      let contId = this.pwa.session.features.pdpCollectionsV2
        ? ".payOption2"
        : "#payOption2";
      const session = this.pwa.session;
      const ampBody$ = $(
        (this.pwa.session.docObjActive || this.pwa.session.docs.pdp).shadowBody
      );

      // wait for price data to be available:
      let prodSku = await this.pwa.pdpDataAbstraction.getSkuDetails();
      let currentPrice = await this.pwa.site.getPDPCurrentPrice();

      // check to see if price has changed or if a collection
      if (this.pwa.session.currentPrice != currentPrice) {
        this.pwa.session.currentPrice = currentPrice;

        session.showPayPal = currentPrice > 30 && currentPrice < 600;
        session.showAfterPayAndKlarna =
          currentPrice > 10 && currentPrice < 2000;

        // now, PayPal is always disabled
        session.showPayPal = false;

        // Handle special exclusion cases
        session.showAfterPayAndKlarna =
          await this.pwa.pdpDataAbstraction.showAfterPayAndKlarna(
            session.showAfterPayAndKlarna
          );

        // hide Klarna for CA for now.
        if (!this.pwa.session.features.pdpKlarna) {
          ampBody$.find(".paymentOption.klarna").remove();
          ampBody$.find(`${contId}`).css("min-height", "unset");
        }

        // if we do not need to show payment options, hide the divs
        if (!session.showAfterPayAndKlarna && !session.showPayPal) {
          $("#womp-pp-message").css({
            "z-index": -1,
            opacity: 0,
          });
          ampBody$.find(`div${contId}`).hide();
          return;
        } else {
          $("#womp-pp-message").css({
            "z-index": 1,
            opacity: 0,
          });
          ampBody$.find(`div${contId}`).show();
        }

        // update price labels
        let paymentPrice =
          Math.round((currentPrice / 4 + Number.EPSILON) * 100) / 100;
        ampBody$.find("span.paymentAmount").text("$" + paymentPrice.toFixed(2));

        // if paypal is visible, update that
        if (!session.paypalIsHidden) {
          this.renderPaypalMessage(currentPrice);
        }
      }
    } catch (ex) {
      debugger;
    }
  }

  async renderPaypalMessage(currentPrice) {
    try {
      // if paypal is not available return, we will call here again once loaded
      if (!window.paypal) return;

      // if this is not a PDP, return
      if (!this.pwa.session.docTests.isPDPReg.test(location.pathname)) return;

      // make doc shortcut
      let doc = this.pwa.session.docObjActive;

      // check to see if we already have an appShell element, if not append one
      var ppMessage = $("#womp-pp-message");
      if (ppMessage.length == 0) {
        // womp-remove class will cause it to be removed in appshellBeforeRender
        $(doc.hostElem.parentElement).append(
          `<div id="womp-pp-message" class="womp-remove"
            style="
              bottom: 0;
              height: 24px;
              left: 0;
              opacity: 0;
              position: fixed;
              width: 100%;
              z-index: 2;
              margin-top: 3px;
            "
          ></div>`
        );
        ppMessage = $("#womp-pp-message");
      }

      // check to see if price has changed
      // XXX Temp hardcode the $30 threashold to show the price for now, switch to API once available

      // call paypal.Messages.render
      await paypal
        .Messages({
          amount: currentPrice,
          style: {
            layout: "custom",
            markup:
              "https://www.paypalobjects.com/upstream/assets/custom/LZ25HUZDSKSPN-2.html",
            logo: {
              type: "primary",
            },
          },
          onRender: () => {
            setTimeout(() => {
              setTimeout(() => {
                ppMessage.css({
                  opacity: 1,
                  "z-index": 2,
                });
              }, 100);
              wmPwa.util.positionAppshellElement(
                "#womp-pp-message",
                "#ppPlaceholder"
              );
            }, 10);
          },
        })
        .render(ppMessage[0]);

      if (this.pwa.session.paypalIsHidden) {
        this.pwa.session.paypalIsHidden = false;
        ppMessage.css({
          "z-index": 2,
          opacity: 1,
        });
      }
    } catch (ex) {
      //debugger;
    }
  }

  async renderWebcollage() {
    // they have a wcAcc variable in their code that determines if webCollage should run, but it looks like it is always true.
    // so for now, just going to always run WC

    if ($("#syndi_inline").length == 0) {
      $(this.pwa.session.docObjActive.hostElem.parentElement).append(
        '<div id="syndi_inline"></div>'
      );
    }

    const moveIntoAmpDoc = async () => {
      // Let syndigo get sorted.
      try {
        await this.pwa.util.waitForElement("syndigo-powerpage");

        const shellElm = $("#syndi_inline");
        const ampBody$ = $(this.pwa.session.docObjActive.shadowBody);
        const ampElm = ampBody$.find("#wc-power-page");
        ampElm.replaceWith(shellElm);
        console.log("WebCollage moved in to Shadow ");
        /*
              Changes for PP-1516 backed out at request of UX until PDP col changes are implemented
              These changes unhide the sticky nav item for Product Information and select it after it is loaded
            */
        // let navItem$ = ampBody$.find(".webCollageNavItem");
        // navItem$.removeAttr("hidden");
        this.pwa.site.socialAnnexPosition();

        ampBody$.find("#webCollageCont").removeAttr("hidden");
        // ampBody$.find(".underline").removeAttr("style");
        // ampBody$.find(".webCollU").css("opacity", "1");

        try {
          const syndigoHost = ampBody$.find("syndigo-powerpage")[0];

          const resizeObserver = new ResizeObserver(
            function (entries) {
              this.pwa.site.socialAnnexPosition();
            }.bind(this)
          );
          resizeObserver.observe(syndigoHost);
        } catch (e) {
          console.warn(`Resize failed for syndigo content`);
        }
      } catch (e) {
        /*
          https://bedbathandbeyond.atlassian.net/browse/PP-3272
          Syndigo removed a class from their content div and it caused the content to load below the footer in the appshell
          Put this in a try catch so that if something fails, we hide the content.
          This may cause issues for consecutive loads
        */
        // console.warn(
        //   `site.moveIntoAmpDoc error loading syndigo content. Hiding the PWA container`
        // );
        if ($("#syndi_inline").length > 0) $("#syndi_inline").hide();
      }
    };

    window.SYNDI = window.SYNDI || [];
    window.SYNDI.push({
      contentCallback: function (hasContent) {
        if (hasContent) {
          moveIntoAmpDoc();
        } else {
          console.warn("window.SYNDI.contentCallback does not have content");
        }
      }.bind(this),
    });

    SYNDI.push(this.pwa.site.prodIdGet(new URL(location.href)));
  }

  async renderSocialAnnex(sa_page, sa_class, sa_function, sa_type, sa_cat) {
    const pathAndSearch = `${location.pathname}${location.search}`;
    const docTests = this.pwa.session.docTests;

    /*
    From window.__INITIAL_STATE__ in page source:
    ....
    socialAnnex: {
      requestUrl:
        "https://s22.socialannex.com/api/product/photos/9411181/:productCode/8749bddc9798a71a8e30b4738b4f7956",
      productComparisonClass:
        "sa_s22_comapare_page_slider s22_multiple_product_",
      siteId: { US: 9411181, Baby: 9411351, Ca: 9411361 },
      src: "//cdn.socialannex.com/partner/9411181/bbb-feo/universal.js",
      scriptId: "socialAnnexContent",
      pageType: {
        CLP: 3,
        SEARCH: 3,
        HOMEPAGE: 1,
        REVIEWYOURPRODUCTS: 9,
        GALLERY: 7,
        PLP: 3,
        COLLEGE: 3,
        REGISTRYDASHBOARD: 1,
        PRODUCTCOMPARISON: 2,
        PDP: 2,
      },
      homePageClass: "sa_s22_instagram_home",
      orderHistoryClass: "sa_s22_photoupload_product_holder",
      defaultClass: "sa_s22_instagram_product",
      orderPageId: "sa_track",
      socialAnnexPrefix: "sa_",
      token: "8749bddc9798a71a8e30b4738b4f7956",
      categoryClass: "sa_s22_instagram_category",
      id: "sa_s22_instagram",
      defaultId: "sa_s22_instagram",
    },
    socialAnnexPhotoRegistry: {
      baseUri:
        "https://s22.socialannex.com/v2/api/photoregistry/images/9411181",
    },*/

    let socialAnnexCss = { margin: "20px -10px 40px -13px" };
    if (docTests.isPDPReg.test(pathAndSearch)) {
      sa_page = "2";
      sa_class = "sa_s22_instagram_product";
      sa_function = "s22LoadProductPage";
      window.sa_s22_product = location.pathname
        .replace(/\/$/, "")
        .split("/")
        .pop();
      socialAnnexCss = { margin: "2rem 0" };
    } else if (
      docTests.isPLPReg.test(pathAndSearch) ||
      docTests.isCLPReg.test(pathAndSearch)
    ) {
      //if this is CLP, listen for social annex intersection, when it is 1000px below viewport
      // -- '3' is CLP page type, this is passed to renderSocialAnnex
      sa_page = "3";
      sa_class = "sa_s22_instagram_category";
      sa_function = "s22LoadCategoryPage";
      sa_type = "category";
      sa_cat = location.pathname.replace(/\/$/, "").split("/").pop();
    } else if (docTests.isHomeReg.test(pathAndSearch)) {
      sa_page = "1";
      sa_class = "sa_s22_instagram_home";
      sa_function = "s22LoadIndexPage";
      sa_type = null;
      sa_cat = null;
    }
    // check to see if this page has a socialAnnex place holder
    let placeholder = $(this.pwa.session.docObjActive.shadowBody).find(
      "#socialannex"
    );
    if (placeholder.length > 0 && !window[sa_function]) {
      // load the script, if it is not already loaded.
      // Script id for US
      let scriptId = "9411181";
      if (wmPwa.session.isCANADA) {
        scriptId = "9411361";
      } else if (wmPwa.session.isBABY) {
        scriptId = "9411351";
      }
      wmPwa.util.scriptAdd(
        `//cdn.socialannex.com/partner/${scriptId}/bbb-feo/universal.js`,
        "socialAnnexClientScript"
      );
    }

    // add placeholder element
    if ($("#sa_s22_instagram").length == 0) {
      $(this.pwa.session.docObjActive.hostElem.parentElement).append(
        '<div id="sa_s22_instagram" class="' +
          sa_class +
          ' womp-remove" style="z-index:1;"></div>'
      );
    }

    // apply margin to our placeholder
    if (socialAnnexCss) placeholder.css(socialAnnexCss);

    // Hide Harmon social annex so that bc it currently does not have this feature
    if (wmPwa.session.isHARMON) {
      $("#socialannex").hide();
      $("#sa_s22_instagram").hide();
    }

    // determine CATEGORY_CODE
    // If pathName contains last char '/' then remove this from path name, fetch last section from path name
    // FOR SOME CRAZY REASON, THESE HAVE TO BE ON THE WINDOW OBJECT! Even though we are also passing them to SA. Otherwise nothing works. Took me a day to figure this out :'(
    window.sa_s22_instagram_category_code = sa_cat;
    window.sa_s22_instagram_category_type = sa_type;
    window.sa_page = sa_page;

    // wait for function to appear, then call it
    await this.pwa.util.waitForProp(sa_function);
    if (sa_function == "s22LoadProductPage") {
      window[sa_function](sa_page, window.sa_s22_product);
    } else {
      window[sa_function](
        sa_page,
        sa_s22_instagram_category_type,
        sa_s22_instagram_category_code
      );
    }

    // wait for [data-page-type][data-count] element to appear
    // Also wait for children to be appended, otherwise #socialannex placeholder height will end up being zero and positioning will be off - JP - 04.28.21
    try {
      await this.pwa.util.waitForElement(
        "div#sa_s22_instagram[data-page-type][data-count] *"
      );
      /* display customer images in sticky nav */
      $(this.pwa.session.docObjActive.shadowBody)
        .find(`#socialAnnexStickyNav`)
        .removeAttr("hidden");
    } catch (e) {
      console.log(`Social annex did not load. Error: ${e}`);
    }

    // position absolutely in the same position as a placeholder element
    this.pwa.site.socialAnnexPosition();

    // if the document height changes, position SA again
    // This is important for pages with WebCollage, since it slowly expands
    try {
      // create an Observer instance
      const resizeObserver = new ResizeObserver((entries) => {
        console.log("Body height changed:", entries[0].target.clientHeight);
        this.pwa.site.socialAnnexPosition();
      });

      // start observing a DOM node
      resizeObserver.observe(document.body);
    } catch (ex) {
      console.error(
        "Could not use positionObserver to monitor for document height changes, hiding SocialAnnex",
        ex
      );
      $("#sa_s22_instagram").hide();
    }

    // XXX append to array to clean up on navigate, is this required?
  }

  /**
   * Hide Social Annex until it can be properly positioned.
   * Primarily used on PDP data-cls accordions with amp-lists
   */
  socialAnnexHide() {
    $("div#sa_s22_instagram[data-page-type][data-count]").addClass("wHide");
  }

  /**
   * Social Annex gets repositioned from many places.
   * Convenience function to avoid binding an
   * anonymous function in Mutation observer callbacks.
   */
  socialAnnexPosition() {
    this.pwa.util.positionAppshellElement(
      "div#sa_s22_instagram[data-page-type][data-count]",
      "#socialannex"
    );
  }

  /**
   * Update elements with relevant amp-state values and call
   * BBB tealium click event handler when curent event cycle is finshed.
   *
   * @param {HTMLElement} elem - HTML element
   *     best practice: pass a cloned element to this async function.
   * @param {Object} obj - supporting data object
   *    Trying this out for Add Cart interactiom
   * @returns {Promise} resolves to undefined
   */
  async tealiumClickEventEmitter(elem, obj) {
    const $e = $(elem);

    // Some functions in the pwaAnalaytics.js scripts have an issue where they fetch state before it's been updated. In the pdpClickOnSku case, sometimes it would send the previous sku's data.
    // Here's a non-blocking timeout that gives extra time for the state to update before calling the tealium function (pdpClickOnSku) directly. This is a simpler solution than using ampListPostRender.
    if ($e.attr("data-cta") == "pdpClickOnSku") {
      try {
        const [prodId] = location.pathname.match(/\d+$/) || [""];
        setTimeout(() => pdpClickOnSku(prodId), 500);
        return;
      } catch (err) {}
    }

    // Typeahead search - add search term
    if ($e.attr("data-cta") == "typeaheadLinkClick") {
      let json = $e.attr("data-attribute");
      let obj = JSON.parse(json);
      obj.search_term = await this.pwa.amp.ampGetState("searchTerm");
      $e.attr("data-attribute", JSON.stringify(obj));
    }

    // special case registry click, currently, data required is not in the DOM. XXX, we also might need to update the DOM form elements here?
    if ($e.attr("data-cta") == "pdpAddToRegistry") {
      let json = $e.attr("data-attribute");
      let obj = JSON.parse(json);

      // for some reason the below does not work, the navigation completes before the await returns
      //let prodSku = await this.pwa.amp.ampGetState("prodSku");

      // However this does work :)
      let prodSku = await this.pwa.pdpDataAbstraction.getSkuDetails();

      let productPrice = await this.pwa.site.getPDPCurrentPrice();

      /* It apepars as if this is already in the object parsed from the data-attribute
         So I am guessing the problem is that it needed to be a string instead of a number?
         https://bedbathandbeyond.atlassian.net/browse/PP-3494
      */
      obj.prodQty =
        typeof obj.prodQty !== "string" && obj.prodQty.length > 0
          ? `${obj.prodQty[0]}`
          : "1";

      obj.product_price = [productPrice];
      obj.product_sku_id = prodSku.SKU_ID;
      obj.skuName = prodSku.data.PRODUCT_DETAILS.DISPLAY_NAME;
      $e.attr("data-attribute", JSON.stringify(obj));
    }

    if (this.pwa.session.isDebug)
      console.log("tealiumClickEventEmitter: ", $e.outerHTML());

    /* callback functions to run when:
      1. event cycle completes (click inside pwa)
      2. ..or when tealium click handler becomes available
        ex: for AMP -> PWA add to cart interactions,
        the product is added to cart before
        tealium click handler is available.
     */
    let tealiumTrigger = function (elem, obj) {
      try {
        // if (this.pwa.session.isStaging)
        //   console.log(
        //     "calling tealiumClickEventHandler for:",
        //     elem.outerHTML,
        //     obj
        //   );
        window.tealiumClickEventHandler(elem, obj);
      } catch (ex) {
        console.warn("tealiumClickEventHandler error:", ex);
      }
    }.bind(this, elem, obj);

    /* BBB Tealium Click Handler Callback */
    if (window.tealiumClickEventHandler) {
      setTimeout(tealiumTrigger);
    } else {
      await this.pwa.util
        .waitForProp("tealiumClickEventHandler", window, 5000)
        .catch((e) => console.warn(e));
      setTimeout(tealiumTrigger);
    }
  }

  /**
   * Store data-cta attribute for Tealium plp-list load analytics,
   * remember what element the user clicked
   * in order to update the product list. Tealium data-ctas:
    plpFacetSelection - click on any checkbox from filter
    plpRemoveOneFacet - remove facet from PLP's
    plpClearAllFacets - click on clear all link
    plpSortBtnClick - click on Sort Button
    plpPaginationClick - click on pagination or next link
   *
   * @param {MouseEvent} clickEvent - Click Event
   */
  async tealiumPlpStateManager(clickEvent) {
    // Update PLP List Interaction state.
    let target$ = $(clickEvent.target);

    /* facet selection click event is firing for both
    .plpOptsSubOptTxt/label and input as click event
    propagates up to parent label. */
    if (target$.is("input")) return;

    if (target$.closest(".plpOptsSubOpt").length)
      this.tealiumConfig.plpListAction = "plpFacetSelection";
    else if (target$.closest(".plpPill").length)
      this.tealiumConfig.plpListAction = "plpRemoveOneFacet";
    else if (target$.is(".plpPillClrAll"))
      this.tealiumConfig.plpListAction = "plpClearAllFacets";
    else if (target$.is(".sort"))
      this.tealiumConfig.plpListAction = "plpSortBtnClick";
    else if (target$.is(".plpPage"))
      this.tealiumConfig.plpListAction = "plpPaginationClick";
  }

  /**
   * Register/Fire tealium events for PLP prod cards.
   * @param {CashJsCollection} ampList - PLP product card amp-list
   */
  async tealiumPlpCardEvents(ampList) {
    if (this.pwa.session.isFast) return;
    let ampListElem = ampList[0];

    const tealiumConfig = this.tealiumConfig;
    if (tealiumConfig.plpListAction) {
      ampList.attr("data-cta", tealiumConfig.plpListAction);
      this.tealiumClickEventEmitter(ampListElem);
    }
    tealiumConfig.plpListAction = "";

    // wait for tealium javascript to load
    await this.pwa.util.waitForProp("ioCallback").catch((e) => console.log(e));

    if (!window.ioCallback) return;
    // Trigger Tealium intersection observer for plp list items.
    const io = new IntersectionObserver(window.ioCallback, {
      root: null,
      rootMargin: "0px",
      threshold: 1,
    });
    ampList.find(".trackName").each((i, prodName) => io.observe(prodName));
  }

  /**
   * Check height of seo content and hide button if not taller than 300px
   * @param {CashJsNode} - Amp body about to be loaded
   * @param {Object} - optional overides
   * @returns {Boolean}
   */
  checkSeoHeight(ampBody, options) {
    const defaults = {
      maxHt: 300,
      btnClass: "seoBtnCont",
      contClass: "seoHide",
      overlay: "clpDescOverlay",
      limitContClass: "seoHide",
    };
    const opt = Object.assign(defaults, options);
    let content = ampBody.find(`.${opt.contClass}`);
    let cont = ampBody.find(`.${opt.limitContClass}`);
    if (content.length == 0) return;
    let mxHt = Number.parseInt(cont.css("max-height"));
    mxHt = isNaN(mxHt) ? opt.maxHt : mxHt;
    let ht = content.height();
    if (ht < mxHt && ht !== 0) {
      ampBody.find(`.${opt.btnClass}`).attr("hidden", "hidden");
      ampBody.find(`.${opt.overlay}`).attr("hidden", "hidden");
      return true;
    }
    return false;
  }

  /**
   *
   * This should only get fired when a user has added an item to the cart from a pure amp page
   * The user is redirected to the PWA plp page, and then the page is scrolled to the product id
   * PP-818 - Amp user journey
   * We could check for document referrer, but not sure that is neccessary as we have the add to cart params
   */
  setPlpPositionFromAmp() {
    try {
      let urlObj = new URL(location.href);
      let pId = urlObj.searchParams.get("prodId");
      let type = urlObj.searchParams.get("type");
      if (
        type == "cart" ||
        type == "pickItUp" ||
        type == "deliverIt" ||
        type == "pickItModal"
      ) {
        this.pwa.util.plpScrollByProdId(
          pId,
          this.pwa.session.docs.primary.shadowDoc.ampdoc
        );
      }
    } catch (e) {
      console.log(
        `Could not find the product scroll position for plp redirect. Error: ${e}`
      );
    }
  }

  /*** listen for clicks on "use current location"
   * - in header/pdp store selectors, plp zip input ***/
  async getCurrentLocation() {
    // Backfilling for old amp pages
    async function geoRevLookup(lat, long) {
      // create the map quest API to get zip code
      let mapQuestZipSrc = `https://www.mapquestapi.com/geocoding/v1/reverse?key=Gmjtd%7Clu6120u8nh,2w%3Do5-lwt2l&location=${lat},${long}`;
      const response = await fetch(mapQuestZipSrc);
      const results = await response.json();
      return results.results[0].locations[0].postalCode;
    }
    async function getBrowserLoc() {
      return await new Promise((resolve, reject) => {
        if (!navigator.geolocation)
          reject({ message: "Geolocation is not available on this browser" });
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          maximumAge: 600000,
          timeout: 10000,
        });
      });
    }
    try {
      const pos = await getBrowserLoc();
      const lat = pos.coords.latitude;
      const long = pos.coords.longitude;
      if (!lat || !long)
        throw new Error("Unable to get lat long for current position");

      let location = await geoRevLookup(lat, long);
      return location;
    } catch (e) {
      console.warn(`Unable to get current location. Error: ${e}`);
      return false;
    }
  }

  async getCurrLocation(ele$, type) {
    function addGeoErr(ele$) {
      ele$.after(
        ` <div class="alert gpsErr noTap">Location error!. Please Try again.</div>`
      );
    }
    function removeWaiting(ele$, content) {
      ele$.html(content);
      ele$.removeClass("noTap");
    }
    ele$.next(".gpsErr").remove();
    let contents = ele$.html();
    try {
      ele$.html("Fetching location...");
      ele$.addClass("noTap");
      let loc = await this.getCurrentLocation();
      if (!loc) throw new Error("Unable to get");

      if (type == "sdd") {
        this.pwa.amp.ampsSetState({
          changeStore: { sddZipcode: loc.replace(/-[0-9]+/, "") },
        });
      } else {
        this.pwa.amp.ampsSetState({ changeStore: { location: loc } });
      }

      removeWaiting(ele$, contents);
      return loc;
    } catch (e) {
      console.warn(
        `Error getting current location in store modal: Error: ${e}`
      );
      removeWaiting(ele$, contents);
      addGeoErr(ele$);
    }
    return false;
  }

  /**
   * calls appshell head function wmLocationSync to update latlngCookie and SDDCZ cookie
   * @param {Object} storeInfoObj - object with data like getDefaultStoreByLatLng api response
   */
  locationCookieSet(storeInfoObj) {
    if (window.wmLocationSync) window.wmLocationSync(false, storeInfoObj);
  }

  /**
   * get store info from element to update latlngCookie
   * called from any place that sets storeId to make sure product-listing api is using correct store information
   * @param {String} argString - object with store info from data-click-handler string
   * @param {CashJSCollection} target$ - element of click event
   * @param {Object} evt - click event object
   */
  storeInfoUpdate(argString, target$, evt) {
    let dataObj = target$.attr("data-store-obj");
    if (dataObj) dataObj = JSON.parse(dataObj);

    this.locationCookieSet({ data: { store: dataObj } });
  }
}

/**
 * This class supports data functions for PDPv2
 * Class to abstract data from individual states for PDP. This will allow us to have
 * Two PDP templates at the same time. This is necessary as we rebuild pages
 * Once we are transitioned, the second class can be removed.
 */
class PdpDataAbstractionV2 {
  constructor(pwa) {
    this.pwa = pwa;
  }

  excludeAfterpay(prod, sku) {
    if (
      (prod &&
        prod.data &&
        prod.data.SKU_DETAILS &&
        prod.data.SKU_DETAILS[0].GIFT_CERT_FLAG == 1) ||
      (sku && sku.MAX_SHIPPING_DAYS && sku.MAX_SHIPPING_DAYS > 15) ||
      (prod.data &&
        prod.data.SKU_DETAILS &&
        prod.data.SKU_DETAILS.length == 1 &&
        prod.data.SKU_DETAILS[0].MAX_SHIPPING_DAYS > 15)
    )
      return true;

    return false;
  }

  /**
   *
   * @returns {Object|Undefined} - Returns the pdp details for a top level product
   */
  async getPDPState(name, pId) {
    try {
      let prodId =
        pId || this.pwa.site.prodIdGet(new URL(this.pwa.session.docs.pdp.href));
      return await this.pwa.amp.ampGetState(`${name}${prodId}`);
    } catch (e) {
      this.pwa.errorCustom(`Unable to get pdpdDetails. Error: ${e}`, e);
    }
    return undefined;
  }
  /**
   *
   * @param {String} type - type of you are checking for: "accessory" or "collection"
   * @returns {Boolean}
   */
  async typeOfProduct(type) {
    try {
      const pdpDetails = await this.getPDPState("pdpDet");
      if (type == "collection") {
        return (
          pdpDetails.data.PRODUCT_DETAILS.PARENT_PROD_INFO &&
          pdpDetails.data.PRODUCT_DETAILS.PARENT_PROD_INFO.length > 0
        );
      }
      if (type == "accessory") {
        return (
          pdpDetails.data.PRODUCT_DETAILS.CHILD_ID &&
          pdpDetails.data.PRODUCT_DETAILS.CHILD_ID.length > 0
        );
      }
    } catch (e) {
      this.pwa.errorCustom(`Unable to get get type of product. Error: ${e}`, e);
    }
    return false;
  }
  /**
   * Get the parent product id from a product that is in a collection
   * @returns {String} - Parent product ID if a collection
   */
  async getParentProductId() {
    try {
      const pdpDetails = await this.getPDPState("pdpDet");
      return pdpDetails.data.PRODUCT_DETAILS.PARENT_PROD_INFO[0].PRODUCT_ID;
    } catch (e) {
      this.pwa.errorCustom(`Unable to get parent product ID. Error: ${e}`, e);
    }
    return undefined;
  }

  /**
   *
   * @param {Boolean} afterpay - The current state of the afterpay flag
   * @returns {Boolean} - returns whether afterpay should be displayed
   */
  async showAfterPayAndKlarna(afterpay) {
    try {
      const [pdpDetails, skuFacets] = await Promise.all([
        this.getPDPState("pdpDet"),
        this.getPDPState("skuFacets"),
      ]);
      const skuGetobj = { data: pdpDetails.data.SKU_DETAILS };
      const sku = this.pwa.site.skuGet(skuGetobj, skuFacets);
      if (this.excludeAfterpay(pdpDetails, sku)) return false;
    } catch (e) {
      this.pwa.errorCustom(`Unable to get parent product ID. Error: ${e}`, e);
      return afterpay;
    }
    return afterpay;
  }

  /**
   *
   * @returns {object||undefined} - Returns the active sku details or the pdpDetails if no skuId is set
   */
  async getSkuDetails(prodId) {
    try {
      let skuFacets = null,
        pdpDetails = null;
      if (prodId) {
        /* passing a product ID is useful for collections and accessories */
        [skuFacets, pdpDetails] = await Promise.all([
          this.getPDPState("skuFacets", prodId),
          this.getPDPState("pdpDet", prodId),
        ]);
      } else {
        [skuFacets, pdpDetails] = await Promise.all([
          this.getPDPState("skuFacets"),
          this.getPDPState("pdpDet"),
        ]);
      }

      if (skuFacets.skuId) {
        const skuGetobj = { data: pdpDetails.data.SKU_DETAILS };
        let sku;
        sku = skuGetobj.data.filter((skuDet) => {
          return skuDet.SKU_ID == skuFacets.skuId;
        })[0];
        sku.data = pdpDetails.data;
        // jk 6.14.21 this uses color and size to get the sku details. In pdpV2 we have skuFacets
        //const sku = this.pwa.site.skuGet(skuGetobj, skuFacets);
        return sku;
      } else if (pdpDetails.data.PRODUCT_DETAILS) {
        return pdpDetails.data.PRODUCT_DETAILS;
      }
    } catch (e) {
      this.pwa.errorCustom(`Unable to get sku details. Error: ${e}`, e);
    }
    return undefined;
  }

  /**
   *
   * @returns {String} - Returns the selected skuId. Empty string if not selected
   */
  async getSelectedSkuId() {
    let facets = await this.getPDPState("skuFacets");
    return facets.skuId;
  }
  /**
   *
   * @returns {String} - Returns the selected skuId. Empty string if not selected
   */
  async getPrice() {
    let facets = await this.getPDPState("skuFacets");
    return facets.skuId;
  }
}

/**
 * This class supports all the data functions specific to the original PDP
 * It can be removed once all PDPv2 have been built
 */
// TODO - Can This V1 class be removed now?
class PdpDataAbstractionV1 extends PdpDataAbstractionV2 {
  constructor(pwa) {
    super();
    this.pwa = pwa;
  }

  /**
   *
   * @param {String} type - type of you are checking for: "accessory" or "collection"
   * @returns {Boolean}
   */
  async typeOfProduct(type) {
    if (this.pwa.session.docTests.isPDPReg.test(location.pathname)) {
      let prodSku = await this.pwa.amp.ampGetState("prodSku");
      if (type == "collection") {
        return (
          prodSku.data.PRODUCT_DETAILS.hasOwnProperty("PARENT_PRODUCT") &&
          prodSku.data.PRODUCT_DETAILS.PARENT_PRODUCT.length > 0
        );
      }
      if (type == "accessory") {
        return prodSku.data.PRODUCT_DETAILS.hasOwnProperty("CHILD_PRODUCT");
      }
    }
    return false;
  }
  /**
   * Get the parent product id from a product that is in a collection
   * @returns {String} - Parent product ID if a collection
   */
  async getParentProductId() {
    try {
      let prodSku = await this.pwa.amp.ampGetState("prodSku");
      return prodSku.data.PRODUCT_DETAILS.PARENT_PRODUCT[0];
    } catch (e) {
      this.pwa.errorCustom(`Unable to get parent product ID. Error: ${e}`, e);
    }
    return undefined;
  }

  /**
   *
   * @param {Boolean} afterpay - The current state of the afterpay flag
   * @returns {Boolean} - returns whether afterpay should be displayed
   */
  async showAfterPayAndKlarna(afterpay) {
    try {
      const [prodSku, prodSkusAll, skuFacets] = await Promise.all([
        this.pwa.amp.ampGetState("prodSku"),
        this.pwa.amp.ampGetState("prodSkusAll"),
        this.pwa.amp.ampGetState("skuFacets"),
      ]);
      const sku = this.pwa.site.skuGet(prodSkusAll, skuFacets);
      if (this.excludeAfterpay(prodSku, sku)) return false;
    } catch (e) {
      this.pwa.errorCustom(`Unable to get parent product ID. Error: ${e}`, e);
    }
    return afterpay;
  }

  async getSkuDetails() {
    return await this.pwa.session.docObjActive.shadowDoc.getState("skuActive");
  }
  /**
   *
   * @returns {String} - Returns the selected skuId. Empty string if not selected
   */
  async getSelectedSkuId() {
    let cart = await this.pwa.amp.ampGetState("cart");
    return cart.sku;
  }
}

/**
 * User-specific state and functionality
 */
class User {
  /**
   * Site interface specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    /* used for creating documents */
    this.pwa = pwa;

    /* User's current account status */
    const securityStatus = this.pwa.util.cookieGet("securityStatus");
    this.hasAcct = securityStatus && securityStatus !== "0";
    /* User's JSESSIONID cookie and dynSessionConfNumber cookie are expired after login (over ~1 hour after login?) */
    this.isRecognized = securityStatus && securityStatus === "2";
    /* User's JSESSIONID cookie and dynSessionConfNumber cookie are not expired after login (under ~1 hour after login?) */
    this.isLoggedIn = securityStatus && securityStatus !== "4";

    /* User has active registry (eventnot in past) */
    this.hasRegistry = this.pwa.session.isHARMON
      ? false
      : this.pwa.util.cookieGet("isActiveRegistrant") === "true";

    /* Users account number  TODO- should this be DYN_USER_ID cookie instead?
    Same number, set by stateful calls like session-confirmation API? */
    this.ATG_PROFILE_DATA = this.pwa.util.cookieGet("ATG_PROFILE_DATA") || "";

    // Useful Constants
    this.apiAddItemList = `${location.origin}/apis/services/core/list/v1.0/add-item-list`;
  }

  addToListMsgRender() {
    // 2. DOM
    $(".addToListMsg").remove();
    let addToListMsg = `
    <button id="addToListMsg" class="msg msgIdeaboardAdded addToListMsg active msgCloseJs">
      <span class="gr025 noTap">Item added to your shopping list!</span>
      <a class="inlineBlock bold white link" href="/store/account/shoppingList">View list</a>
    </button>`;
    $("body").append(addToListMsg);

    let addToListMsg$ = $("#addToListMsg");

    // 3. Event: confirmation message tap - closing animation & remove from DOM.
    addToListMsg$.on("click", function (evt) {
      let addToListMsg$ = $(evt.target);
      addToListMsg$.removeClass("active");
      setTimeout(
        function (addToListMsg$) {
          addToListMsg$.remove();
        }.bind(this, addToListMsg$),
        500
      );
    });

    // 4. Close confirmation message for user after 6 seconds
    setTimeout(
      function (addToListMsg$) {
        addToListMsg$.trigger("click");
      }.bind(this, addToListMsg$),
      6000
    );
  }

  /**
   * Check for a stale session before page navigation.
   * User logs in, waits > 18 minutes, picks up phone and clicks on link.
   *
   * Appshell has a similar request for logged in users without dynSessionConfNumberValidity=true cookie
   *
   * @returns {Promise} - resolves once session-confirmation API has been called
   */
  async ampBeforeUnload() {
    /* dynSessionConfNumberValidity=true cookie is required for amp-user-info to return user name.
			Call session confirmation API for logged in users ( securityStatus == (2 || 4) )
			if dynSessionConfNumberValidity=true cookie is not present */
    const dynSessionConfNumberValidity = this.pwa.util.cookieGet(
      "dynSessionConfNumberValidity"
    );
    const dynSessionConfNumber = this.pwa.util.cookieGet(
      "dynSessionConfNumber"
    );
    const isValidSession =
      dynSessionConfNumber && dynSessionConfNumberValidity == "true";

    if (this.hasAcct && !isValidSession)
      await this.sessionConfirmationHeadersGetOrSet();
  }

  /**
   * User-specific amp before render modifications
   * @param {CashJs} ampDoc$ - The amp document fragment before it is attached to the DOM
   */
  ampBeforeRenderUser(ampDoc$) {
    // Skip for anonymous users
    if (!this.hasAcct) return;

    /*** Data ***/
    this.ampUpdateUserState(ampDoc$);

    /*** Navigation ***/
    // Logged in user account panel has different dimensions
    ampDoc$.find("#accountV2DskList").attr({
      height: 328,
      width: 376,
    });
    ampDoc$.find(".accountTxt").text("My Account");

    /** Search ***/
    this.searchMsgUpdate(ampDoc$);

    /*** CTAs ***/
    // PLP
    // disable navigation on add to shopping list <a> tags
    $(
      this.pwa.$$$(
        ampDoc$[0],
        'a[data-click-handler*="handleAddToList"],a[data-click-handler*="pdp.collectAddToShopList"]'
      )
    ).removeAttr("href");

    // PDP
    $(
      this.pwa.$$$(ampDoc$[0], 'a[data-click-handler*="getProductBundleSkus"]')
    ).removeAttr("href [href]");
  }

  /**
   * Update login status in before render.
   * Currently only called in ampBeforeRenderUser,
   * But we may want to call later after a user creates a registry for the first time.
   * @param {CashJs} ampDoc$ - The amp document
   * @param {boolean} isBeforeRender - If this is called before AMP Doc fragment is attached to the DOM
   */
  ampUpdateUserState(ampDoc$, isBeforeRender = true) {
    const userState = {
      hasAcct: this.hasAcct,
      hasRegistry: this.hasRegistry,
    };

    if (isBeforeRender)
      // Set logged in state for personalized navigation amp-list logic
      this.pwa.amp.ampSetStateBeforeRender(ampDoc$, "userState", userState);
    else this.pwa.amp.ampsSetState({ userState: userState });
  }

  // click handler wrapper for product bundles
  async getProductBundleSkus(prodId) {
    if (!this.hasAcct) return;

    // get product bundle state items
    const [productBundle, skuFacets, bundleExclude] = await Promise.all([
      this.pwa.amp.ampGetState("productBundle"),
      this.pwa.amp.ampGetState(`skuFacets${prodId}`),
      this.pwa.amp.ampGetState(`bundleExclude`),
    ]);

    let skuId = "";

    // if a sku has been selected use that
    if (skuFacets && skuFacets.skuId) {
      skuId = skuFacets.skuId;
    }

    if (!skuId) return;

    // get either default sku product bundle or the currently selected sku product bundle
    let bundleSkus = productBundle.fusion.bundles[skuId]
      .filter((item) => !(bundleExclude || []).includes(item.SKU_ID))
      .map((item) => [item.PRODUCT_ID, item.SKU_ID]);

    // call add to list handler for each product bundle item
    return await this.bulkShoppingListAdd(bundleSkus);
  }

  async bulkShoppingListAdd(bundleSkus) {
    // call add to list handler for each product bundle item
    let userAuthHeaders =
      await this.pwa.user.sessionConfirmationHeadersGetOrSet();
    let handleListPromises = [];
    for (let bundle of bundleSkus) {
      handleListPromises.push(
        this.handleAddToList(bundle.join(","), {}, {}, userAuthHeaders)
      );
    }
    try {
      await Promise.all(handleListPromises);
      this.addToListMsgRender();
    } catch (e) {
      console.warn(`user.bulkShoppingListAdd error. Error: ${e}`);
      return false;
    }
    return true;
  }

  async handleAddToList(argsString, target$, event, bundleUserAuthHeaders) {
    // 0. Should this run?
    // Skip for anonymous users
    if (!this.hasAcct) return;

    const [prodId, skuId] = argsString
      .split(",")
      .map((val) => (val || "").trim());
    if (!prodId || !skuId) return;

    // 1. AJAX
    const addListUrl = new URL(this.apiAddItemList);
    const listParams = addListUrl.searchParams;
    listParams.set("listId", "");
    listParams.set("profileId", this.ATG_PROFILE_DATA);
    listParams.set("skuId", skuId);
    listParams.set("productId", prodId);
    listParams.set("quantity", 1);
    listParams.set("serialNum", 70789);
    listParams.set("marketPlaceItem", false);
    listParams.set("marketPlaceItemOverSized", false);
    listParams.set("marketPlaceOfferId", "");
    let addToList;
    try {
      const addToListRes = await fetch(addListUrl, {
        credentials: "include",
        method: "POST",
        headers: Object.assign(
          {},
          bundleUserAuthHeaders && bundleUserAuthHeaders["atg-rest-depth"]
            ? bundleUserAuthHeaders
            : await this.pwa.user.sessionConfirmationHeadersGetOrSet()
        ),
      });
      if (!addToListRes.ok) return;

      addToList = await addToListRes.json();
    } catch (e) {}
    if (!addToList.data.itemAdded) return;

    if (!bundleUserAuthHeaders) this.addToListMsgRender();

    // 5. return that event was successfully handled
    return true;
  }

  async ampListPostRenderUser(ampList$) {
    // #cartCount is powered by amp-user-info API
    if (!ampList$.is("#cartCount")) return;

    try {
      const ampUserInfo = await this.pwa.amp.ampGetState("user");
      if (!ampUserInfo.data.userFirstName) return;

      this.ampUserInfo = ampUserInfo;
      let ampBody$ = ampList$.closest("body");

      this.searchMsgUpdate(ampList$.closest("body"));
      this.beyondPlusMemberUpdate(this.ampUserInfo, ampBody$);

      this.writeReviewUserUpdate();

      this.pwa.college.userCollegeDataSet(this.ampUserInfo);
      const csModalList = ampBody$.find("#csModalList");
      this.pwa.college.ampListPostRenderCollege(csModalList);

      return true;
    } catch (e) {}
  }

  async logout() {
    await fetch(
      `${location.origin}/apis/stateful/v1.0/authentication/logout?web3feo`,
      {
        method: "POST",
        body: JSON.stringify({
          deviceId: null,
        }),
      }
    );
    location.href = `${location.origin}?logout=true`;
  }

  searchMsgUpdate(ampElem$) {
    try {
      let firstName = this.ampUserInfo.data.userFirstName;
      if (!firstName || !ampElem$.length) return;

      // TODO - remove .searchInput .sHide[\\[text\\]] after 1.1.22
      const msgPersonal = `Hi ${this.pwa.util.titleCase(
        firstName
      )}, what are you looking for today?`;
      let searchPlaceholder = ampElem$.find(
        ".searchInput .sHide[\\[text\\]], [data-search-placeholder-tablet]"
      )[0];
      // replace div text and [text] attribute
      searchPlaceholder.outerHTML = searchPlaceholder.outerHTML.replace(
        /What product can we help you find\?/gi,
        msgPersonal
      );
    } catch (e) {
      // this.ampUserInfo.data.userFirstName may not exist on first page load
      // when this is called the first time in ampBeforeRender.
      return;
    }
  }

  /*
    This is an edge case scenario where the modal is opened using the writeReview=true query param
    In that case, ampUserInfo has not been initialized.
    This is called after ampUserInfo is called
  */
  writeReviewUserUpdate() {
    if ($("#writeReviewModal").length == 0) return;
    $("#writeReviewModal")
      .find("#screenname")
      .val(this.ampUserInfo.data.userFirstName);
    return;
  }

  /*
    Checking if the user is a Beyond+ member from the amp-user-info api and adding a class, if it is
    This allows us to hide regular pricing on Beyond+ products for PLP pages
  */
  beyondPlusMemberUpdate(userInfo, ampElem) {
    try {
      if (userInfo.data.tealiumUserData.beyond_plus_indicator == "member")
        ampElem.addClass("beyondMember");
      return true;
    } catch (e) {
      console.log(
        `Telium user data not available for determing user's beyond+ membership status. Error: ${e}`
      );
    }
    return false;
  }

  /**
   * Returns anti-session-hijacking headers for user-specific stateful API calls
   * (amp-user-info for logged in users, add to cart, add to shopping list, add to ideaboard, registry calls, etc )
   *
   *
   * Temporary:
   *
   *   Sets dynSessionConfNumberValidity=true cookie for legacy stateful API calls.
   *   If 18 minute dynSessionConfNumberValidity=true cookie expires,
   *   then session-confirmation API needs to be called again before a stateful call.
   *   Otherwise session-confirmation headers can be reused.
   *
   * Reference: https://bedbathandbeyond.atlassian.net/browse/PPS-4704
   *
   * @param {Object} sessionConfirmationObj (opt) - session-confirmation API response:
   *    only pre-fetched in appshell on first page load for logged in or recognized users
   *    without dynSessionConfNumberValidity=true cookie
   * @returns {Promise} resolves to anti-session-hijacking header object
   */
  async sessionConfirmationHeadersGetOrSet(sessionConfirmationObj) {
    // Check cookies, return dynSessionConf headers if they have already been fetched in the last 18 minutes.
    let dynSessionConfNumber = this.pwa.util.cookieGet("dynSessionConfNumber");
    let dynSessionConfNumberValidity = this.pwa.util.cookieGet(
      "dynSessionConfNumberValidity"
    );
    if (
      !sessionConfirmationObj &&
      dynSessionConfNumber &&
      dynSessionConfNumberValidity
    ) {
      return {
        _dynSessConf: dynSessionConfNumber,
        "atg-rest-depth": 2,
        "x-bbb-site-id": this.pwa.session.siteId || "",
      };
    }

    // check if fetch was already done in appshell
    // dynSessionConfNumberValidity cookie expires every 18 minutes
    // this path will fire if user loads page, waits 20 minutes,
    // then navigates, clicks add to cart, or other stateful interaction.
    if (!sessionConfirmationObj) {
      try {
        let sessionConfirmationRes = await fetch(
          `${location.origin}/apis/stateful/v1.0/authentication/session-confirmation`,
          {
            credentials: "same-origin",
          }
        );
        sessionConfirmationObj = await sessionConfirmationRes.json();
      } catch (ex) {
        throw this.pwa.errorCustom("unable to confirm user session", ex);
      }
    }
    dynSessionConfNumber =
      sessionConfirmationObj.data.sessionConfirmationNumber;
    const traceId = sessionConfirmationObj.data.traceId || "";

    // TEMP: React depends on this unsecure, client-side cookie.
    // React team plans on removing and depending on dynSessionConfNumber cookie expiration.
    // Avineet told us the max age is 19 minutes not 18 minutes. He asked us to udpate.
    // 19 (min) * 60 (sec) = 1140 (seconds)
    this.pwa.util.cookieSet("dynSessionConfNumber", dynSessionConfNumber);
    this.pwa.util.cookieSet("dynSessionConfNumberValidity", true, 1140);
    return {
      _dynSessConf: dynSessionConfNumber,
      "atg-rest-depth": 2,
      "x-bbb-site-id": this.pwa.session.siteId || "",
      "x-b3-spanid": traceId,
      "X-B3-TraceId": traceId,
    };
  }
}

/**
 * Generic utilities
 * Functional-style functions that can be used without referencing "this"
 */
class Util {
  /**
   * Site interface specific elements and variables
   * @param {Pwa} pwa - reference to parent document loader instance
   */
  constructor(pwa) {
    /* used for creating documents */
    this.domParser = new DOMParser();
    this.pwa = pwa;
  }

  /**
   * Escapes a string for use in a html attribute
   * https://stackoverflow.com/questions/7753448/how-do-i-escape-quotes-in-html-attribute-values
   * @param {string} s - the string to escape
   * @param {boolean} preserveCR - whether to preserve newLines
   */
  attrEncode(s, preserveCR) {
    preserveCR = preserveCR ? "&#13;" : "\n";
    return (
      ("" + s) /* Forces the conversion to string. */
        .replace(/&/g, "&amp;") /* This MUST be the 1st replacement. */
        .replace(
          /'/g,
          "&apos;"
        ) /* The 4 other predefined entities, required. */
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        /*
        You may add other replacements here for HTML only
        (but it's not necessary).
        Or for XML, only if the named entities are defined in its DTD.
        */
        .replace(/\r\n/g, preserveCR) /* Must be before the next replacement. */
        .replace(/[\r\n]/g, preserveCR)
    );
  }

  /**
   * General cookie getter
   */
  cookieGet(name) {
    var match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    if (match) return match[2];
  }

  /**
   * General cookie setter
   * maxage, path, domain, and secure are optional; path defaults to root
   */
  cookieSet(name, value, maxage, path, domain, secure, crossOrigin) {
    var cookieString = name + "=" + value;
    cookieString += path ? "; path=" + path : "; path=/";
    if (maxage) cookieString += "; max-age=" + maxage;
    if (domain) cookieString += "; domain=" + domain;
    if (secure) cookieString += "; secure";
    // Enable Cross origin access for cookies set via setCookie
    if (crossOrigin) cookieString += "; SameSite=None";
    document.cookie = cookieString;
  }

  /**
   * When the specified attribute changes on the element,
   * run the provided callback.
   *
   * @param {Element} elem - the element to watch
   * @param {String} attr - the attribute to watch
   * @param {Function} cb - What to do when attr changes
   * @param {Array} args - (opt) array of arguments to pass to cb callback
   * @returns {Promise} -> undefined
   *    registers a MutationObserver on the element.
   *    Call this.disconnect() in the cb callback to disconnect
   */
  async elemAttrEvent(elem, attr, cb, args = []) {
    const inputObserver = new MutationObserver((mutations) => {
      mutations.forEach(cb.bind(inputObserver, ...args));
    });

    inputObserver.observe(elem, {
      attributes: true,
      attributeFilter: [attr],
    });
  }

  // add a space after the third character in a canadian zip code
  // only does so if the user is typing not using delete
  fixCaZipcode(e) {
    var $input = $(this);
    var val = $input.val();
    if (
      val.length >= 4 &&
      val[3] != " " &&
      e.inputType != "deleteContentForward"
    ) {
      val = val.slice(0, 3) + " " + val.slice(3);
      $input.val(val);
    }
  }

  /**
   * Force an input to only be numeric
   */
  forceNumeric() {
    var $input = $(this);
    $input.val($input.val().replace(/[^\d]+/g, ""));
  }

  /**
   * AJAX-Submit a form using fetch instead of the browser.
   * Currently assumes enctype="application/x-www-form-urlencoded"
   *
   * @param {Pwa} pwa - document loader
   * @param {CashJsCollection} form - Form to submit.
   */
  async formFetch(form) {
    // Collect the form data while iterating over the inputs
    const endpoint = form.attr("action") || form.attr("action-xhr");
    const formApiResponse = await fetch(endpoint, {
      credentials: "include",
      method: form.attr("method"),
      headers: {
        "Content-Type":
          form.attr("enctype") || "application/x-www-form-urlencoded",
      },
      body: form.serialize(),
    });

    if (!formApiResponse.ok)
      throw this.pwa.errorCustom(
        `${endpoint} endpoint failure`,
        formApiResponse
      );

    return formApiResponse;
  }

  /*
        Extracts current validity from <input> element's ValidityState

        input.validity ValidityState example:
        {
          badInput: false,
          customError: false,
          patternMismatch: false,
          rangeOverflow: false,
          rangeUnderflow: false,
          stepMismatch: false,
          tooLong: false,
          tooShort: false,
          typeMismatch: false,
          valid: true, // 'valid' will be returned from this function.
          valueMissing: false,
        }

        @param {ValidityState} validityState - input.validity to extract validity key
        @returns {String} - currently active validity key
       */
  formValidateInput(validityState) {
    for (const validity in validityState) {
      if (validityState[validity] == true) return validity;
    }
  }

  /**
   * Validates, ensures valid CRSF Token, and AJAX submits a form.
   * Decorates form with validity and status classes.
   *
   * @param {CashJsCollection} form - form being submitted
   * @type {String} - json | text
   * @returns {Boolean} - Whether the form is valid
   */
  async formValidate(form) {
    // 1. Validate form
    // Get all of the form elements
    let fields = form[0].elements;
    let invalidFields = [];

    for (const field of fields) {
      let validity = this.formValidateInput(field.validity);
      field.setAttribute("validity", validity);
      if (validity !== "valid") invalidFields.push(field);
    }

    // If invalid, return
    if (invalidFields.length) {
      form.addClass("formInvalid");
      invalidFields[0].focus();
      return false;
    } else {
      return true;
    }
  }

  /**
   * Converts form inputs into a plain JS object
   * @param {CashJsCollection} form - jQuery-like form
   * @returns {Object} - All selected form inputs as an object
   */
  formToObject(form) {
    const formUrl = new URL(`${location.origin}?${form.serialize()}`);
    const obj = {};
    for (const [key, val] of formUrl.searchParams.entries()) {
      obj[key] = val;
    }
    return obj;
  }

  /*
   * Recursively merge properties of obj2 into obj1
   *
   * This function matches the behavior of AMP.setState,
   * which only adds properties to objects and does not delete properties
   * To reset a property using this function or AMP.setState:
   *    1. set property to null, 2. then call mergeRecursive.
   *
   * This differs from the behavior of AMP.setState in that it
   * merges arrays as well. This costs O(n^2), so best used for small arrays.
   *
   * @param {Object} obj1 - Target object
   * @param {Object} obj2 - Source object
   */
  mergeRecursive(obj1, obj2) {
    try {
      for (var p in obj2) {
        // Property in destination object set; update its value.
        if (obj1[p] == undefined) {
          obj1[p] = obj2[p];
        } else if (
          obj1[p].constructor == Object &&
          obj2[p].constructor == Object
        ) {
          obj1[p] = this.mergeRecursive(obj1[p], obj2[p]);
        } else if (
          obj1[p].constructor == Array &&
          obj2[p].constructor == Array
        ) {
          obj1[p] = obj2[p].concat(
            obj1[p].filter((item) => obj2[p].indexOf(item) == -1)
          );
        } else {
          obj1[p] = obj2[p];
        }
      }
    } catch (ex) {
      console.log(ex);
    }

    return obj1;
  }

  /**
   * Calls the callback function after frequent events stop firing.
   * The resize event isn't important yet, so leaving it out for simpler callback.
   * @param {Function} fn - callback function to trigger immediately
   * @param {number} interval - How long to wait between "repetitions"
   */
  onThrottledBegin(fn, interval = 100) {
    let timeout;
    return function () {
      if (timeout) return;
      fn();
      timeout = setTimeout(() => {
        clearTimeout(timeout);
        timeout = null;
      }, interval);
    };
  }

  /**
   * Calls the callback function after frequent events stop firing.
   * The resize event isn't important yet, so leaving it out for simpler callback.
   * @param {Function} fn - callback function
   * @param {number} interval - How long to wait after last event before triggering callback
   */
  onThrottledEnd(fn, interval = 100) {
    let timeout;
    return function () {
      clearTimeout(timeout);
      timeout = setTimeout(fn, interval);
    };
  }

  /**
   *
   * @param {Document} ampDoc - currrent amp document
   * @param {Object} opt - override any of the default classes or functionality
   * Checks to make sure two inputs with the matching selector class have the same value.
   */
  inputsMustMatch(ampDoc, eventType, opt) {
    function setValidityState(inputs, action) {
      if (action == "add") {
        $(inputs).attr("validity", "invalid");
      } else {
        $(inputs).attr("validity", "valid");
      }
    }
    const options = typeof opt == "undefined" ? {} : opt;
    const handler = this.pwa.util.createInputMatchHandler(options, false);
    ampDoc.removeEventListener(eventType, handler);
    ampDoc.addEventListener(
      eventType,
      (event) => {
        const input = event.target;
        handler(input);
      },
      true
    );
  }

  createInputMatchHandler(opt) {
    const def = {
      invalidClass: "invalidMatch",
      validFormClass: "user-valid",
      matchSelector: "inputMatch",
      eventType: "change",
      useForm: false,
    };
    const o = Object.assign(def, opt);
    return function (input) {
      const options = o;
      if (!options.useForm && !$(input).hasClass(options.matchSelector)) return;
      let valid = true;
      let form = options.useForm ? input : $(input).closest("form");
      let items = $(form).find(`.${options.matchSelector}`);
      let value = $(items).eq(0).val();
      items.each(function () {
        let tmpVal = $(this).val();
        if (tmpVal !== value && tmpVal.trim() !== "") {
          valid = false;
          return false;
        }
      });
      if (valid) {
        $(items).removeClass(options.invalidClass);
      } else {
        $(items).addClass(options.invalidClass);
      }
      return valid;
    };
  }

  /**
   * Parses a document string and returns a HTML document
   *
   * @param {String} docString - HTML Document string
   * @returns {Document} - Document (not attached to DOM)
   */
  parseDoc(docString) {
    return this.domParser.parseFromString(docString, "text/html");
  }

  // /**
  //  * Creates a document fragment from an HTML string
  //  * @param {String} strHTML - HTML string
  //  * @returns DocumentFragment
  //  */
  // parseFragment(strHTML) {
  //   this.range = this.range || document.createRange();
  //   return this.range.createContextualFragment(strHTML);
  // }

  /**
   * @description return all elements found in context element and child template elements
   *
   * element.querySelectorAll ignores template element content by design.
   * This includes template DOM in the querySelectorAll
   * so that it can be updated before amp-lists render.
   *
   * @param {Element} context - element to query
   * @param {String} selector - element CSS selector
   * @returns {[Element]} - an array of Element(s) that match the selector
   */
  querySelectorAllDomAndTemplate(context, selector) {
    const domElems = Array.from(context.querySelectorAll(selector));

    const templates = context.querySelectorAll("template");
    let templateElemsAll = [];
    for (const template of templates) {
      templateElemsAll = templateElemsAll.concat(
        Array.from(template.content.querySelectorAll(selector))
      );
    }

    return domElems.concat(templateElemsAll);
  }

  /**
   * Overrides document referrer
   * @param {string} referrer
   */
  referrerSet(referrer) {
    if (!referrer) return;
    try {
      Object.defineProperty(document, "referrer", {
        configurable: true,
        get: function () {
          return referrer;
        },
      });
    } catch (ex) {}
  }

  /**
   * decides whether modalOpen needs to be added or removed
   * modalOpen class keeps the background from scrolling while a modal is open
   * it exists on the appshell and the ampBody
   *
   * @param {Object} docObj - current active ampBody
   * @param {CashJsCollection} target$ - target the click handler was fired on
   */
  scrollToggle(docObj, target$) {
    if (
      target$.attr("data-modal-close") !== undefined &&
      target$.attr("data-modal-open") === undefined &&
      $("body").hasClass("modalOpen")
    ) {
      $("body").removeClass("modalOpen");
      docObj.shadowBody.classList.remove("modalOpen");
    } else if (target$.is(".navPill.active, .dskNavItem1.active")) {
      $("body").removeClass("modalOpen");
      docObj.shadowBody.classList.remove("modalOpen");
    } else if (target$.attr("data-modal-open") !== undefined) {
      if (this.pwa.desktop.isDesktop)
        target$.closest("body").removeClass("miniHeader");
      // Also add .modalOpen to shadow body - this is used to style the scrollbar gutter on modal open.
      // adding .modalOpen to mobile to prevent scroll.
      $("body").addClass("modalOpen");
      docObj.shadowBody.classList.add("modalOpen");
    } else if (target$.attr("data-modal-close") !== undefined) {
      $("body").removeClass("modalOpen");
      docObj.shadowBody.classList.remove("modalOpen");
    }
  }

  /**
   * Waits for an element to visisble, then calls a function
   *
   * @param {CashJsCollection} elm$ - element we are waiting to be visisble
   * @param {String} margin - intersection observer rootmargin
   * @param {Function} callback - max number of wait attemps
   */
  runFunctionOnIntersect(elm$, margin, callback, args) {
    // root: this.pwa.session.docObjActive.hostElem.parentElement,
    if (elm$.length > 0) {
      elm$.show(); // make it visible so the observer works.
      let observer = new IntersectionObserver(
        function (entries, SELF) {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              SELF.disconnect(entry.target);
              callback.apply(null, args);
            }
          });
        },
        {
          root: null,
          rootMargin: margin,
          threshold: 0,
        }
      );
      observer.observe(elm$[0]);

      // do we need to store and clean up these observers?
      // I was thinking we do, but this says otherwise: https://stackoverflow.com/questions/25314352/how-does-object-observe-unobserve-interact-with-garbage-collection
      // this.pwa.session.observers.push(observer);
    }
  }

  /**
   * @description Adds a script to the head of the document
   * Also see site.scriptsEveryPagePostRender &
   * site.scriptsFirstPagePostRender for a more declarative way to
   * import scripts defined in appshell script templates.
   *
   * @param {String} src - Script source
   */
  scriptAdd(src, id, callback) {
    // make sure it has not already been loaded
    if (id && $("head script#" + id).length > 0) {
      // script is already loaded, so call callback
      if (callback) {
        callback();
      }
      return;
    }
    let script = document.createElement("script");
    script.setAttribute("async", "");
    script.setAttribute("src", src);
    if (id) {
      script.setAttribute("id", id);
    }
    if (callback) {
      script.onload = callback.bind(this);
    }
    document.head.appendChild(script);
  }

  /**
   * Download Mustache.js for rendering templates
   */
  async scriptAddMustache() {
    if (window.Mustache) return;
    this.pwa.util.scriptAdd(`${location.origin}/amp/7865/mustache.min.js`);
  }

  /**
   * Throttles Scroll event callbacks in a performant way.
   * https://developer.mozilla.org/en-US/docs/Web/API/Document/scroll_event#Scroll_event_throttling
   *
   * @param {function} fn - callback
   * @param {Document|Element} target - Container to monitor for scroll events
   * @param {Number} minInterval - min number of ms between triggering functions
   * @returns {function} - throttle function that can be removed from target later.
   *
   */
  scrollEvtThrottle(fn, target, minInterval = 0) {
    // debugger
    // if (target.tagName == 'BODY') target = document;

    let last_known_scroll_position = 0;
    let ticking = false;
    const throttler = function (pwa, e) {
      last_known_scroll_position = window.scrollY;
      if (!ticking) {
        window.requestAnimationFrame(function () {
          fn.bind(pwa)(e, last_known_scroll_position);
          setTimeout(function () {
            ticking = false;
          }, minInterval);
        });

        ticking = true;
      }
    }.bind(null, this.pwa);
    document.addEventListener("scroll", throttler, { passive: true });
    document.addEventListener("touchmove", throttler, { passive: true });
    return throttler;
  }

  /**
   * Throttles any event.
   * Usage: simpleThrottle(handleClickEvent, 25)
   *
   * @param {function} callback - Event handler.
   * @param {number} interval - Timeout duration in ms.
   */
  simpleThrottle(callback, interval) {
    let enableCall = true;

    return function (...args) {
      if (!enableCall) return;

      enableCall = false;
      callback.apply(this, args);
      setTimeout(() => (enableCall = true), interval);
    };
  }

  /**
   * Scrolls an element into view.
   * Called manually or via event handlers
   *
   * @param HTMLElement - Container to search for hashAnchor.
   * @param {String} hashAnchorId - The CSS id selector of the element to scroll into view
   */
  scrollIntoView(scopeElem, hashAnchorId) {
    if (hashAnchorId.indexOf("=") !== -1) return;

    try {
      const elem =
        scopeElem.querySelector(hashAnchorId) ||
        scopeElem.querySelector(`a[name="${hashAnchorId.replace("#", "")}"]`);

      if (elem && elem.scrollIntoView) {
        // console.log("scrolling Into View");
        // Timeout in order to scroll after next amp-bind cycle hides/shows things.
        setTimeout(
          function (elem) {
            elem.scrollIntoView({ alignToTop: true, behavior: "auto" });
          }.bind(null, elem),
          100
        );
      }
    } catch (ex) {}
  }

  /**
   * Prevents other Native JS handlers from handling an event.
   * https://medium.com/@jacobwarduk/how-to-correctly-use-preventdefault-stoppropagation-or-return-false-on-events-6c4e3f31aedb
   *
   * Note: This only stops AMP event handlers for AMP page elements present at page load.
   * Event handlers are fired in the order that they are registered, and for amp-list content
   * the AMP framework handlers are attached before the content is attached to the DOM.
   * To get around this, you can remove and reattach amp-list content in amp.ampListPostRender
   * to get priority in handling events, but you will (usually) lose amp functionality in that element.
   *
   * @param {Event} event - event such as 'click' or 'submit'
   * @returns undefined
   *    Prevents other JS handlers from handling the event.
   */
  stopEvent(event) {
    event.preventDefault && event.preventDefault(); // Prevent browser from handling event
    event.stopPropagation && event.stopPropagation(); // Prevent parent Shadow-v0 body handler from handling event
    // https://caniuse.com/#search=stopimmediatepropagation
    event.stopImmediatePropagation && event.stopImmediatePropagation(); // prevent peer AMP component JS from handling event
  }

  /**
   * Converts a href string into a URL object
   *
   * @param {String} href - Absolute or relative path
   * @returns {URL} - URL object for a specific path
   */
  urlObjGet(href) {
    try {
      const link = document.createElement("a");
      link.href = href;
      const urlObj = new URL(link.href);
      if (urlObj) {
        const session = this.pwa.session;

        // 7.6.21 Remove all trailing slashes
        // if (session.docTests.isUnclosedBrandReg.test(urlObj.pathname))
        //   urlObj.pathname = urlObj.pathname + "/";
        if (urlObj.pathname.endsWith("/") && urlObj.pathname !== "/") {
          urlObj.pathname = urlObj.pathname.slice(
            0,
            urlObj.pathname.length - 1
          );
        }

        // optional staging feature: load staging version of prod urls to stay in staging domain.
        if (
          session.isStaging &&
          /bedbathandbeyond|buybuybaby/i.test(urlObj.hostName)
        )
          urlObj.hostname = location.hostname;

        // JW 8.17.21 - temporarily remove quickView until we can implement chooseOptions
        urlObj.searchParams.delete("quickView");
        // 4.5 fix up the sitespect URLs
        // This is required for SiteSpect to work. We need to trim off the trailing '=', and also
        // switch the '%3A' back to ':'
        // these items are being added by the browser APIs when we call something like: urlObj.searchParams.delete("web3feo");
        if (urlObj.searchParams.get("SS_PREVIEW_EXP")) {
          urlObj.href = urlObj.href.replace("%3A", ":").replace(/=$/, "");
        }

        // urlObj.searchParams.delete("wmPwa");
        // urlObj.searchParams.delete("AppShellId");
        return urlObj;
      } else return null;
    } catch (ex) {
      return null;
    }
  }

  /**
   * Returns a Promise that resolves once
   * the required property is available on the object.
   * Rejects if maxWait occurs.
   *
   * @param {String} propName - property name
   * @param {String} scope - an object that we need to test for a property
   * @param {Number} maxWait - Number of milliseconds to wait before rejecting
   * @param {Number} checkInterval - Number of milliseconds to wait between checks
   */
  waitForProp(propName, scope = window, maxWait = 20000, checkInterval = 150) {
    return new Promise((resolve, reject) => {
      // check now, maybe we do not need to wait
      if (
        (scope == window && window[propName]) ||
        (scope != window && scope && scope[propName])
      ) {
        resolve(scope[propName]);
      }

      let timeout = setTimeout(() => {
        clearInterval(interval);
        reject(`could not find ${scope.toString()}['${propName}']`);
      }, maxWait);

      let interval = setInterval(() => {
        if (
          (scope == window && window[propName]) ||
          (scope != window && scope && scope[propName])
        ) {
          clearInterval(interval);
          clearTimeout(timeout);
          // console.log(`${scope.toString()}['${propName}'] found`);
          resolve(scope[propName]);
        } else {
          // console.log(`${scope.toString()}['${propName}'] not found`);
          return;
        }
      }, checkInterval);
    });
  }

  /**
   * Returns a Promise that resolves once
   * the required element is available in the dom.
   * Rejects if maxWait occurs.
   *
   * @param {String} selector - property name
   * @param {Element} scope - document/element that we need to test for element
   * @param {Number} maxWait - Number of milliseconds to wait before rejecting
   * @param {Number} checkInterval - Number of milliseconds to wait between checks
   */
  waitForElement(
    selector,
    scope = document,
    maxWait = 20000,
    checkInterval = 150
  ) {
    return new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        clearInterval(interval);
        reject(`could not find ${selector}`);
      }, maxWait);

      let interval = setInterval(() => {
        if (scope.querySelector(selector)) {
          clearInterval(interval);
          clearTimeout(timeout);
          // console.log(`${selector} found`);
          resolve(scope.querySelector(selector));
        } else {
          // console.log(`${selector} not found`);
          return;
        }
      }, checkInterval);
    });
  }

  /**
   * Absolutely positions an element in the appshell to be in the same place as an element in the AMP page
   * The AMP element should have the required margin and position, it's size will be set by this function
   * @param {string} appshellSelector - A selector for an element in the appshell to position, this element must be in wmPwa.session.docObjActive.hostElem.parentElement
   * @param {number} ampPlaceholderSelector - A selector for an element in the amp document to match
   */
  positionAppshellElement(appshellSelector, ampPlaceholderSelector) {
    // select our elements
    const shellElm = $(appshellSelector);
    const ampElm = $(this.pwa.session.docObjActive.shadowBody).find(
      ampPlaceholderSelector
    );

    // sanity check
    if (shellElm.length === 0 || ampElm.length === 0) return;

    // Hide appshell elements if PLP no results
    const wmContent =
      this.pwa.session.docObjActive.shadowBody.querySelector("#wm_content");
    if (wmContent && wmContent.classList.contains("noResults")) {
      shellElm.addClass("wHide");
    } else {
      shellElm.removeClass("wHide");
    }

    const positionElement = this.debounce(
      function (shellElm, ampElm) {
        // calculate the top and left of our placeholder, this will be the top left of our shellElm
        const bot = window.scrollY + ampElm[0].getBoundingClientRect().top;
        const left = window.scrollX + ampElm[0].getBoundingClientRect().left;
        const maxWidth = ampElm.width();

        // "max-width": `calc(100% - ${left}px)`,
        // Apply top and width to appshell element
        shellElm.css({
          left: left,
          "max-width": maxWidth,
          position: "absolute",
          top: bot,
          // for socialAnnex rendering on PLP
          width: maxWidth,
        });
        if (maxWidth != 0) {
          shellElm.removeClass("wHide");
        }

        // "max-width": `calc(${shellElm.width()} - ${left}px)`,
        // Apply height to AMP element
        ampElm.css({
          display: "block",
          height: shellElm.height(),
          // "max-width": maxWidth,
          // width: maxWidth
          // width: shellElm.width(),
        });
      },
      500,
      true
    );
    // console.log("shellElm.height():", shellElm.height());
    // debugger;
    // if (shellElm.height() < 5) {
    //   debugger;
    // }
    positionElement(shellElm, ampElm);

    // observe shellElm for changes, I would really like to use ResizeObserver here, but this is only available in iOS 13+

    function subscriber(mutations) {
      // mutations.forEach((mutation) => {
      //   // handle mutations here
      //   positionElement(shellElm, ampElm);
      // });
      // JW - I believe we only need to run this once per batch as all the mutations
      // have already happened in a batch
      positionElement(shellElm, ampElm);
    }

    // JW TODO - measure how expensive it is to run positionElement on every DOM addition/removal
    new MutationObserver(subscriber).observe(shellElm[0], {
      attributes: false,
      attributeOldValue: false,
      characterData: false,
      characterDataOldValue: false,
      childList: true,
      subtree: true,
    });

    // also observe the AMP doc, because the position of the ampElm might change
    new MutationObserver(subscriber).observe(
      this.pwa.session.docObjActive.shadowBody,
      {
        attributes: false,
        attributeOldValue: false,
        characterData: false,
        characterDataOldValue: false,
        childList: true,
        subtree: true,
      }
    );

    window.addEventListener(
      "resize",
      this.pwa.util.onThrottledEnd(function () {
        positionElement(shellElm, ampElm);
      }),
      { passive: true }
    );

    // mark the resize listener to be cleaned up

    // XXX mark the shellElm to be cleaned up, required?
  }

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  // from https://davidwalsh.name/javascript-debounce-function
  debounce(func, wait, immediate) {
    var timeout;
    return function () {
      var context = this,
        args = arguments;
      var later = function () {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(context, args);
    };
  }

  /**
   * Determines if we are on mobile or desktop, maybe in the future expand this to look at screensize?
   */
  isDesktop() {
    return !/ipod|phone|mobile|mini/i.test(navigator.userAgent);
  }

  /**
   * Return the Womp Site ID
   */
  siteId() {
    if (/bbbyapp|bedbathandbeyond\.com/.test(location.host)) {
      // US
      return 7865;
    } else if (/bbbycaapp|bedbathandbeyond\.ca/.test(location.host)) {
      // CA
      return 7876;
    } else if (/bbbabyapp|buybuybaby/.test(location.host)) {
      // Baby
      return 7876;
    } else if (/harmonfacevalues/.test(location.host)) {
      // Harmon
      return 7917;
    } else {
      //default to US
      return 7865;
    }
  }

  /**
   * Convert a string to kebab case, borrowed from https://www.w3resource.com/javascript-exercises/fundamental/javascript-fundamental-exercise-123.php
   */
  // toKebabCase(str) {
  //   if (!str) return;
  //   return str
  //     .match(
  //       /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g
  //     )
  //     .map((x) => x.toLowerCase())
  //     .join("-");
  // }

  /**
   * Convert a string to kebab case, borrowed from https://www.w3resource.com/javascript-exercises/fundamental/javascript-fundamental-exercise-123.php
   * JW remove single and double quotes to match BBB url encoding.
   */
  toKebabCase(str) {
    if (!str) return;
    return str
      .replace(/'|"/g, "")
      .match(
        /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g
      )
      .map((x) => x.toLowerCase())
      .join("-");
  }

  // JW 3.19.21 - doesn't appear to be used
  // KebabCaseToText(str) {
  //   return str
  //     .split("-")
  //     .map((s) => s.charAt(0).toUpperCase() + s.substring(1))
  //     .join(" ");
  // }
  /**
   * Wrapper for ampsSetStateBeforeRender for toggling hidden elements
   * @param {String} selector - css selector for selecting the object with cashJs
   * @param {CashJsCollection} doc$ - Amp document as Cash collection
   * @param {*} stateId  - id used to set the Amp state
   * @param {*} stateObj - object you want to set
   */
  toggleHiddenBeforeRender(selector, doc$, stateId, stateObj) {
    doc$.find(selector).each((i, e) => {
      let item = $(e);
      item.removeAttr("hidden");
      this.pwa.amp.ampSetStateBeforeRender(doc$, stateId, stateObj);
    });
  }

  /**
   *
   * @param {String} prodId  - product id to scroll to
   * @param {*} doc - doc to search for product card with prodId
   * @returns {Boolean} - scroll success
   */
  plpScrollByProdId(prodId, doc) {
    try {
      let card = doc.getElementById(`prodCard${prodId}`);
      let header = doc.getElementById(`headerWrap`);
      let y = card.offsetTop - header.offsetHeight + window.outerHeight / 2;
      window.scrollTo(window.scrollLeft, y);
      return true;
    } catch (e) {
      console.log(
        `Unable to get plp scroll position with product id ${prodId}. Error: ${e}`
      );
    }
    return false;
  }

  /**
   *
   * @param {CashJsCollecion} context - the document where the template exists
   * @param {Regex} findReg - the replacement regex
   * @param {String} replaceWith- replacement string
   * @param {String} templateId - ID of the template where we want to replace the string
   */
  replaceStringInTemplate(context, findReg, replaceWith, templateId) {
    let template = context.find(`#${templateId}`);
    if (template.length == 0) return;
    let markup = template.html();
    let replacedM = markup.replace(findReg, replaceWith);
    template.html(replacedM);
    /*
      Below doesn't work. Replaces all the markup with text because it uses textContent
      All nodes are in a document fragment
      This just takes the top level nodes and replaces textContent, which removes all the markup
    */
    // Array.from(tmpContent.childNodes)
    //   .map((item) => {
    //     item.textContent = item.textContent.replace(findReg, replaceWith);
    //   })
    //   .join(" ");
  }

  /**
   * Use this function as a fallback to make sure content is not cut off above the fold.
   * This function will cause CLS, so use sparingly.
   * If the placeholder function is implemented correctly, this function should not do anything
   * @param {CashJs Node} ampList - amp list that is being rendered and you want to compare height with placeholder
   */
  resetListHeight(ampList) {
    setTimeout(this.pwa.amp.ampsAmpStateIsStableEvt.bind(this), 500);
    // TODO - refactor this and .prodFulfillmentList resize check
    // expand if prodList is larger than container
    const replacedContent = ampList
      .find("div[placeholder] ~ div:not([overflow])")
      .children()
      .eq(0);
    const replacedContentHeight = replacedContent.height();
    if (replacedContentHeight > ampList.height()) {
      console.log(
        `CLS Warning: resetListHeight list height for amp list with id ${ampList.attr(
          "id"
        )}. ReplaceContentHeight: ${replacedContentHeight}. Amp list height ${ampList.height()} `
      );
      ampList.css("height", replacedContentHeight);
      ampList.find(".btnFulfillMore").remove();
    }
    //Remove after stabilizes
    if (replacedContentHeight + 50 < ampList.height()) {
      console.log(
        `CLS Warning: resetListHeight shrinking list height for amp list with id ${ampList.attr(
          "id"
        )}. ReplaceContentHeight: ${replacedContentHeight}. Amp list height ${ampList.height()} `
      );
      ampList.css("height", replacedContentHeight);
    }
  }

  /**
   * Converts 'TITLE case sTRing' to 'Title Case String'
   * @param {String} str - string to convert
   * @returns {String}
   */
  titleCase(str) {
    if (typeof str !== "string")
      throw TypeError("titleCase() requires a string");
    if (!str.length) return str;

    // note change to array type
    str = str.trim().split(" ");

    for (var i = 0, x = str.length; i < x; i++) {
      str[i] =
        (str[i][0] ? str[i][0].toUpperCase() : "") +
        (str[i].substr(1) ? str[i].substr(1).toLowerCase() : "");
    }

    return str.join(" ");
  }

  /**
   * This seemed like a simpler approach to handling _dynaSessConf errors.
   * It can be used with same function signature as fetch, so easy to refactor
   * Stateful calls sometimes error out with a _dynaSessConf error
   * This will call the sampe api twice after clearing cookies if it detects a _dynaSessConf error
   *
   * @param {String} url - Stateful url to fetch
   * @param {Object} opt - headers for api call
   * @returns {Object} - response object retrieved from the fetch call.
   */
  async statefulFetch(url, opt) {
    async function stateFetch(url, opt) {
      return await fetch(url, opt);
    }
    function checkErr(resp) {
      return (
        resp.errorMessages &&
        resp.errorMessages.length > 0 &&
        /Missing _dynSessConf/gi.test(resp.errorMessages[0].message)
      );
    }
    let resp = null;
    try {
      const respObj = await stateFetch(url, opt);
      resp = await respObj.json();
      if (checkErr(resp)) {
        this.pwa.util.cookieSet("dynSessionConfNumber", "");
        this.pwa.util.cookieSet("dynSessionConfNumberValidity", "");
        opt.headers = Object.assign(
          opt.headers,
          await this.pwa.user.sessionConfirmationHeadersGetOrSet()
        );
        const respObj2 = await stateFetch(url, opt);
        resp = await respObj2.json();
      }
    } catch (e) {
      resp.error = e;
    }
    return resp;
  }
  /**
   *
   * @param {Array} params  - an array of params to clear off the url that is passed
   * @param {String} url - A url string that you want to replace the state with
   */
  clearParams(params, url) {
    try {
      let urlObj = new URL(url);
      for (const param of params) {
        urlObj.searchParams.delete(param);
      }
      history.replaceState(null, "", urlObj.href);
      return true;
    } catch (e) {
      console.warn(`util.clearParams error. Error: ${e}`);
    }
    return false;
  }
}

/**
 * Starts the Pwa and loads the current URL.
 *
 * @param {Object} pwaSessionInit - configuration object for pwa.session
 */
function pwaStart(pwaSessionInit) {
  console.time("pwaFirstPageRender");
  /* Generate new PWA object with optional pwaSessionInit configuration object */
  window.wmPwa = new Pwa(window, pwaSessionInit);

  /* Appshell has polyfiled older browsers at this point. Load first document */
  window.wmPwa.appshell.appshellEventHandlersRegister(window.wmPwa);
  window.wmPwa.load(location.href);
}
