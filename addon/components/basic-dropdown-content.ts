import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { join } from '@ember/runloop';
import { getScrollParent } from '../utils/calculate-position';
import {
  distributeScroll,
  getAvailableScroll,
  getScrollDeltas,
} from '../utils/scroll-helpers';
import hasMoved from '../utils/has-moved';
import { Dropdown } from './basic-dropdown';
import { isTesting } from '@embroider/macros';

interface Args {
  transitioningInClass?: string;
  transitionedInClass?: string;
  transitioningOutClass?: string;
  isTouchDevice?: boolean;
  destination: string;
  dropdown: Dropdown;
  renderInPlace: boolean;
  preventScroll?: boolean;
  rootEventType: 'click' | 'mousedown';
  top: string | undefined;
  left: string | undefined;
  right: string | undefined;
  width: string | undefined;
  height: string | undefined;
  otherStyles: Record<string, string>;
  onFocusIn?: (dropdown?: Dropdown, event?: FocusEvent) => void;
  onFocusOut?: (dropdown?: Dropdown, event?: FocusEvent) => void;
  onMouseEnter?: (dropdown?: Dropdown, event?: MouseEvent) => void;
  onMouseLeave?: (dropdown?: Dropdown, event?: MouseEvent) => void;
  shouldReposition: (
    mutations: MutationRecord[],
    dropdown: Dropdown
  ) => boolean;
}
type RootMouseDownHandler = (ev: MouseEvent | TouchEvent) => void;

export default class BasicDropdownContent extends Component<Args> {
  transitioningInClass =
    this.args.transitioningInClass || 'ember-basic-dropdown--transitioning-in';
  transitionedInClass =
    this.args.transitionedInClass || 'ember-basic-dropdown--transitioned-in';
  transitioningOutClass =
    this.args.transitioningOutClass ||
    'ember-basic-dropdown--transitioning-out';
  isTouchDevice =
    this.args.isTouchDevice || Boolean(!!window && 'ontouchstart' in window);
  dropdownId = `ember-basic-dropdown-content-${this.args.dropdown.uniqueId}`;
  private touchMoveEvent?: TouchEvent;
  private handleRootMouseDown?: RootMouseDownHandler;
  private scrollableAncestors: Element[] = [];
  private mutationObserver?: MutationObserver;
  @tracked animationClass = this.transitioningInClass

  get destinationElement(): Element | null {
    return document.getElementById(this.args.destination);
  }

  get animationEnabled(): boolean {
    return !isTesting();
  }

  /**
   * Allows similair behaviour to `ember-composable-helpers`' `optional` helper.
   * Avoids adding extra dependencies.
   * Can be removed when the template `V1` compatability event handlers are removed.
   *
   * @see https://github.com/cibernox/ember-basic-dropdown/issues/498
   * @memberof BasicDropdownContent
   */
  noop(): void {}

  @action
  setup(dropdownElement: Element): void {
    let triggerElement = document.querySelector(
      `[data-ebd-id=${this.args.dropdown.uniqueId}-trigger]`
    );
    this.handleRootMouseDown = (e: MouseEvent | TouchEvent): any => {
      if (e.target === null) return;
      let target = e.target as Element;
      if (
        hasMoved(e as TouchEvent, this.touchMoveEvent) ||
        dropdownElement.contains(target) ||
        (triggerElement && triggerElement.contains(target))
      ) {
        this.touchMoveEvent = undefined;
        return;
      }

      if (dropdownIsValidParent(target, this.dropdownId)) {
        this.touchMoveEvent = undefined;
        return;
      }

      this.args.dropdown.actions.close(e, true);
    };
    document.addEventListener(
      this.args.rootEventType,
      this.handleRootMouseDown,
      true
    );
    window.addEventListener('resize', this.runloopAwareReposition);
    window.addEventListener('orientationchange', this.runloopAwareReposition);

    if (this.isTouchDevice) {
      document.addEventListener('touchstart', this.touchStartHandler, true);
      document.addEventListener('touchend', this.handleRootMouseDown, true);
    }
    if (triggerElement !== null) {
      this.scrollableAncestors = getScrollableAncestors(triggerElement);
    }
    this.addScrollHandling(dropdownElement);
  }

  @action
  teardown(): void {
    this.removeGlobalEvents();
    this.removeScrollHandling();
    this.scrollableAncestors = [];

    document.removeEventListener(
      this.args.rootEventType,
      this.handleRootMouseDown as RootMouseDownHandler,
      true
    );

    if (this.isTouchDevice) {
      document.removeEventListener('touchstart', this.touchStartHandler, true);
      document.removeEventListener(
        'touchend',
        this.handleRootMouseDown as RootMouseDownHandler,
        true
      );
    }
  }

  @action
  animateIn(dropdownElement: Element): void {
    if (!this.animationEnabled) return;
    waitForAnimations(dropdownElement, () => {
      this.animationClass = this.transitionedInClass;
    });
  }

  @action
  animateOut(dropdownElement: Element): void {
    if (!this.animationEnabled) return;
    let parentElement = dropdownElement.parentElement;
    if (parentElement === null) return;
    if (this.args.renderInPlace) {
      parentElement = parentElement.parentElement;
    }
    if (parentElement === null) return;
    let clone = dropdownElement.cloneNode(true) as Element;
    clone.id = `${clone.id}--clone`;
    clone.classList.remove(...this.transitioningInClass.split(' '));
    clone.classList.add(...this.transitioningOutClass.split(' '));
    parentElement.appendChild(clone);
    this.animationClass = this.transitioningInClass;
    waitForAnimations(clone, function() {
      (parentElement as HTMLElement).removeChild(clone);
    });
  }

  @action
  setupMutationObserver(dropdownElement: Element): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      let shouldReposition = mutations.some(
        (record: MutationRecord) =>
          containsRelevantMutation(record.addedNodes) ||
          containsRelevantMutation(record.removedNodes)
      );

      if (shouldReposition && this.args.shouldReposition) {
        shouldReposition = this.args.shouldReposition(
          mutations,
          this.args.dropdown
        );
      }

      if (shouldReposition) {
        this.runloopAwareReposition();
      }
    });
    this.mutationObserver.observe(dropdownElement, {
      childList: true,
      subtree: true,
    });
  }

  @action
  teardownMutationObserver(): void {
    if (this.mutationObserver !== undefined) {
      this.mutationObserver.disconnect();
      this.mutationObserver = undefined;
    }
  }

  @action
  touchStartHandler(): void {
    document.addEventListener('touchmove', this.touchMoveHandler, true);
  }

  @action
  touchMoveHandler(e: TouchEvent): void {
    this.touchMoveEvent = e;
    document.removeEventListener('touchmove', this.touchMoveHandler, true);
  }

  @action
  runloopAwareReposition(): void {
    join(this.args.dropdown.actions.reposition);
  }

  @action
  removeGlobalEvents(): void {
    window.removeEventListener('resize', this.runloopAwareReposition);
    window.removeEventListener(
      'orientationchange',
      this.runloopAwareReposition
    );
  }

  // Methods
  addScrollHandling(dropdownElement: Element): void {
    if (this.args.preventScroll === true) {
      let wheelHandler = (event: WheelEvent) => {
        if (event.target === null) return;
        let target = event.target as Element;
        if (
          dropdownElement.contains(target) ||
          dropdownElement === event.target
        ) {
          // Discover the amount of scrollable canvas that is within the dropdown.
          const availableScroll = getAvailableScroll(target, dropdownElement);

          // Calculate what the event's desired change to that scrollable canvas is.
          let { deltaX, deltaY } = getScrollDeltas(event);

          // If the consequence of the wheel action would result in scrolling beyond
          // the scrollable canvas of the dropdown, call preventDefault() and clamp
          // the value of the delta to the available scroll size.
          if (deltaX < availableScroll.deltaXNegative) {
            deltaX = availableScroll.deltaXNegative;
            event.preventDefault();
          } else if (deltaX > availableScroll.deltaXPositive) {
            deltaX = availableScroll.deltaXPositive;
            event.preventDefault();
          } else if (deltaY < availableScroll.deltaYNegative) {
            deltaY = availableScroll.deltaYNegative;
            event.preventDefault();
          } else if (deltaY > availableScroll.deltaYPositive) {
            deltaY = availableScroll.deltaYPositive;
            event.preventDefault();
          }

          // Add back in the default behavior for the two good states that the above
          // `preventDefault()` code will break.
          // - Two-axis scrolling on a one-axis scroll container
          // - The last relevant wheel event if the scroll is overshooting

          // Also, don't attempt to do this if both of `deltaX` or `deltaY` are 0.
          if (event.defaultPrevented && (deltaX || deltaY)) {
            distributeScroll(deltaX, deltaY, target, dropdownElement);
          }
        } else {
          // Scrolling outside of the dropdown is prohibited.
          event.preventDefault();
        }
      };
      document.addEventListener('wheel', wheelHandler, {
        capture: true,
        passive: false,
      });
      this.removeScrollHandling = () => {
        document.removeEventListener('wheel', wheelHandler, { capture: true });
      };
    } else {
      this.addScrollEvents();
      this.removeScrollHandling = this.removeScrollEvents;
    }
  }

  // Assigned at runtime to ensure that changes to the `preventScroll` property
  // don't result in not cleaning up after ourselves.
  removeScrollHandling(): void {}

  // These two functions wire up scroll handling if `preventScroll` is false.
  // These trigger reposition of the dropdown.
  addScrollEvents(): void {
    window.addEventListener('scroll', this.runloopAwareReposition);
    this.scrollableAncestors.forEach((el) => {
      el.addEventListener('scroll', this.runloopAwareReposition);
    });
  }
  removeScrollEvents(): void {
    window.removeEventListener('scroll', this.runloopAwareReposition);
    this.scrollableAncestors.forEach((el) => {
      el.removeEventListener('scroll', this.runloopAwareReposition);
    });
  }
}

function containsRelevantMutation(nodeList: NodeList): boolean {
  for (let i = 0; i < nodeList.length; i++) {
    const node = nodeList[i];
    if (
      node.nodeName !== '#comment' &&
      !(node.nodeName === '#text' && node.nodeValue === '')
    ) {
      return true;
    }
  }
  return false;
}

// All ancestors with scroll (except the BODY, which is treated differently)
function getScrollableAncestors(triggerElement: Element): Element[] {
  let scrollableAncestors = [];
  if (triggerElement) {
    let parent = triggerElement.parentNode;
    if (parent !== null) {
      let nextScrollable: Element | undefined = getScrollParent(
        parent as Element
      );
      while (
        nextScrollable &&
        nextScrollable.tagName.toUpperCase() !== 'BODY' &&
        nextScrollable.tagName.toUpperCase() !== 'HTML'
      ) {
        scrollableAncestors.push(nextScrollable);
        let nextParent = nextScrollable.parentNode;
        if (nextParent === null) {
          nextScrollable = undefined;
        } else {
          nextScrollable = getScrollParent(nextParent as Element);
        }
      }
    }
  }
  return scrollableAncestors;
}

function closestContent(el: Element): Element | null {
  while (
    el &&
    (!el.classList || !el.classList.contains('ember-basic-dropdown-content'))
  ) {
    if (el.parentElement === null) return null;
    el = el.parentElement;
  }
  return el;
}

function waitForAnimations(element: Element, callback: Function): void {
  window.requestAnimationFrame(function () {
    let computedStyle = window.getComputedStyle(element);
    if (
      computedStyle.animationName !== 'none' &&
      computedStyle.animationPlayState === 'running'
    ) {
      let eventCallback = function () {
        element.removeEventListener('animationend', eventCallback);
        callback();
      };
      element.addEventListener('animationend', eventCallback);
    } else {
      callback();
    }
  });
}

/**
 * Evaluates if the given element is in a dropdown or any of its parent dropdowns.
 *
 * @param {HTMLElement} el
 * @param {String} dropdownId
 */
function dropdownIsValidParent(el: Element, dropdownId: string): boolean {
  let closestDropdown = closestContent(el);
  if (closestDropdown === null) {
    return false;
  } else {
    let closestAttrs = closestDropdown.attributes as unknown as any;
    let trigger = document.querySelector(
      `[aria-controls=${closestAttrs.id.value}]`
    );
    if (trigger === null) return false;
    let parentDropdown = closestContent(trigger);
    if (parentDropdown === null) return false;
    let parentAttrs = parentDropdown.attributes as unknown as any;
    return (
      (parentDropdown && parentAttrs.id.value === dropdownId) ||
      dropdownIsValidParent(parentDropdown, dropdownId)
    );
  }
}
