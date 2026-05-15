$(document).ready(function () {

    /* ── Sticky navbar + scroll-up btn ─────────────────── */
    $(window).scroll(function () {
        if (this.scrollY > 20) {
            $('.navbar').addClass('sticky');
        } else {
            $('.navbar').removeClass('sticky');
        }
        if (this.scrollY > 500) {
            $('.scroll-up-btn').addClass('show');
        } else {
            $('.scroll-up-btn').removeClass('show');
        }
    });

    /* ── Scroll-up button ───────────────────────────────── */
    $('.scroll-up-btn').click(function () {
        $('html').animate({ scrollTop: 0 }, 500);
        $('html').css('scrollBehavior', 'auto');
    });

    /* ── Smooth scroll on nav links ─────────────────────── */
    $('.navbar .menu li a').click(function () {
        $('html').css('scrollBehavior', 'smooth');
        $('.navbar .menu').removeClass('active');
        $('.menu-btn i').removeClass('active');
    });

    /* ── Mobile menu toggle ──────────────────────────────── */
    $('.menu-btn').click(function () {
        $('.navbar .menu').toggleClass('active');
        $('.menu-btn i').toggleClass('active');
    });

    /* ── Typed.js ────────────────────────────────────────── */
    var typedHero = new Typed('.typing', {
        strings: ['Developer', 'Designer', 'Blogger', 'YouTuber', 'Freelancer'],
        typeSpeed: 90,
        backSpeed: 50,
        backDelay: 1400,
        loop: true
    });

    var typedAbout = new Typed('.typing-2', {
        strings: ['Developer', 'Designer', 'Blogger', 'YouTuber', 'Freelancer'],
        typeSpeed: 90,
        backSpeed: 50,
        backDelay: 1400,
        loop: true
    });

    /* ── Skill bars animate on scroll ───────────────────── */
    var skillsAnimated = false;
    function animateSkills() {
        if (skillsAnimated) return;
        var skillsTop = $('.skills').offset().top;
        var scrollBottom = $(window).scrollTop() + $(window).height();
        if (scrollBottom > skillsTop + 100) {
            $('.skills .line').addClass('animate');
            skillsAnimated = true;
        }
    }
    $(window).scroll(animateSkills);
    animateSkills(); // run on load in case already visible

    /* ── Owl Carousel ────────────────────────────────────── */
    $('.carousel').owlCarousel({
        margin: 24,
        loop: true,
        autoplay: true,
        autoplayTimeout: 2800,
        autoplayHoverPause: true,
        smartSpeed: 600,
        responsive: {
            0:    { items: 1, nav: false },
            600:  { items: 2, nav: false },
            1000: { items: 3, nav: false }
        }
    });

});
                              
