<template>
  <div class="header">
    <img src="holly.png" alt="" class="img1" />
    <img
      src="holly.png"
      alt=""
      class="img2"
      @click="clearSessionStorage"
      @tap="clearSessionStorage"
    />
  </div>
  <h1>
    <img src="hat.png" alt="" class="hat" />
    Santa's List
  </h1>
  <h2>
    Find out if you're <span class="red">Naughty</span> or
    <span class="green">Nice</span>
  </h2>
  <div class="santaQuote mb2 italic">
    I made a list - and checked it twice!<br />- Santa
  </div>
  <div class="mb2 italic" style="text-align: right"></div>

  <div class="mb2" style="position: relative; width:fit-content; margin:0 auto 2rem;">
    <input id="filter" v-model="filterText" placeholder="Search" class="" />
    <button class="clearFilter" @click="filterText = ''">
      <svg class="xBtn" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
    </button>
  </div>

  <div class="listBox">
    <div
      v-for="{ name, status } in filteredList.slice(0, 20)"
      :key="name"
      class="flex xpListL textLeft"
    >
      <span class="w50 maxw200 capitalize">{{ name }}</span>
      <span
        :class="{
          green: status == 'nice',
          red: status == 'naughty',
        }"
        >{{ status }}</span
      >
    </div>
  </div>
  <div v-show="filterText.length <= 1" style="margin-top: 2rem">
    Page 1 of 350,000,000
  </div>
  <span class="copyright"
    >Copyright 2021 Santa's Workshop<br />The North Pole</span
  >
</template>

<script>
export default {
  name: "App",
  components: {},
  data() {
    return {
      listRaw: [
        "Pfaffenroth, eden",
        "Pfaffenroth, jake",
        "Riggs, annie",
        "Pfaffenroth, hadley",
        "kyles, molly",
        "Kyles, chris",
        "kyles, eleanor",
        "kyles, henry",
        "goger, logan",
        "Whyemseyae, evelynn",
        "Whyemseyae, goldie",
        "Whyemseyae, Joy",
        "mcdermott, sophia",
        "pfaffenriggs, gus",
        "whitehead, finley",
        "Giuliani, Rudy-x",
        "McConnell, Mitch-x",
        "drumpf, donald-x",
        "Mallory, Masood",
        "Turner, Faron",
        "Aust, Dwight",
        "Woodward, Aaron",
        "Stern, Viktor",
        "Kirby, Harith",
        "Oursler, Bjørn",
        "Süss, Klaudia",
        "Wyman, Yunus",
        "Huddleston, Fredrik",
        "Nylund, Tamara",
        "Hodges, Zula",
        "Jeffries, Chantal",
        "Chapman, Uwe",
        "Teel, Teresia",
        "Assante, Armand",
        "Arthur, King",
        "Aguilera, Christina",
        "Alba, Jessica",
        "Applegate, Christina",
        "Aaron, Hank",
        "Abagnale, Frank",
        "Abbey, Edward",
        "Abel, Reuben-x",
        "Abelson, Hal",
        "Abourezk, James",
        "Abrams, Creighton",
        "Ace, Jane-x",
        "Acton, John",
        "Adams, Abigail",
        "Adams, Douglas",
        "Adams, Henry",
        "Adams, John",
        "Adams, John Quincy",
        "Adams, Samuel",
        "Adams, Scott",
        "Addams, Jane",
        "Addison, Joseph",
        "Adorno, Theodor-x",
        "Adler, Alfred",
        "Affleck, Ben",
        "Agena, Keiko-x",
        "Agnew, Spiro",
        "Ahbez, Ethel",
        "Ahern, Bertie",
        "Ah Koy, James",
        "Aiken, Clay",
        "Aiken, Conrad",
        "Akinola, Peter Jasper",
        // "Yankovic, Alfred",
      ],
      params: "",
      filterText: "",
    };
  },
  methods: {
    clearSessionStorage() {
      // let keys = Array.from(Object.keys(window.sessionStorage));
      // console.log("keys:", keys);
      window.sessionStorage.clear();
      this.params = "";
      this.listRaw.splice(this.listRaw.indexOf("Yankovic, Alfred"), 1);
      this.listRaw.push("Yankovic, Alfred");
    },
  },
  computed: {
    overrides() {
      if (!this.params) return;
      const params = this.params.toLowerCase().replace("?", "").split("&");

      return params.map((person) => {
        const split = person.split("=");
        window.sessionStorage.setItem(split[0], split[1]);
        return { name: split[0], status: split[1] };
      });
    },
    list() {
      const list = [...this.listRaw.map((x) => x.toLowerCase())].sort();

      return list.map((item) => {
        let name = item.toLowerCase();
        let status =
          window.sessionStorage.getItem(name.split(", ")[1]) || "nice";

        if (this.overrides?.find((x) => x.name == name.split(", ")[1])) {
          status = this.overrides.find(
            (x) => x.name == name.split(", ")[1]
          ).status;
          // if (status == "trending") status = "trending naughty";
        }
        status = decodeURIComponent(status);

        if (/-x/.test(name)) {
          name = name.replace("-x", "");
          status = "naughty";
        }

        // if (/^mc/.test(name)) {
        //   name = name.replace(/^mc(.)/, "mc" + "$1".toUpperCase());
        // }

        // name = name.replace(/(^.)/, "$1".toUpperCase());

        return { name, status };
      });
    },
    filteredList() {
      return this.filterText.length > 1
        ? this.list.filter(
            (x) =>
              x.name.includes(this.filterText.toLowerCase()) ||
              x.status.includes(this.filterText.toLowerCase())
          )
        : this.list;
    },
    fakePage() {
      return this.filterText.length > 1
        ? (Math.random() * 350000000).toFixed(0).toLocaleString()
        : 1;
    },
  },
  async created() {
    async function getNames(listRaw) {
      console.log(listRaw.filter((name) => /^a/i.test(name)).length);
      const users = await fetch(
        "https://random-data-api.com/api/users/random_user?size=100"
      );
      const newNames = (await users.json()).map(
        (x) => `${x.last_name}, ${x.first_name}`
      );
      listRaw = listRaw.concat(newNames);
      if (listRaw.filter((name) => /^a/i.test(name)).length > 19) {
        return listRaw;
      } else {
        await getNames(listRaw);
      }
    }

    this.listRaw = await getNames(this.listRaw);

    if (location.search) {
      this.params = location.search;
      history.pushState({}, "", location.pathname);
    }
  },
};
</script>

<style>
@import url("https://fonts.googleapis.com/css2?family=Cedarville+Cursive&family=Londrina+Solid&display=swap");

html {
  color: white;
  background-color: firebrick;
}

#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  /* color: #2c3e50; */
  margin-top: 60px;
}
h1 {
  position: relative;
  max-width: fit-content;
  margin: 0 auto;
}
.header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  display: flex;
}
.header img {
  width: 15%;
  max-width: 125px;
}
.header .img1 {
  margin-right: auto;
  transform: scaleX(-1);
}
.hat {
  width: 2rem;
  position: absolute;
  left: -1rem;
  top: -0.2rem;
  transform: rotate(-35deg);
}
input,
input:focus {
  padding: 8px 32px 8px 16px;
  font-size: 1rem;
}
.listBox {
  max-width: 30rem;
  margin: 0 auto;
  padding: 1rem 2rem;
  background-color: white;
  color: initial;
  border-radius: 8px;
}
/* @media (min-width: 24rem) {
  .listBox {
    min-width: 30rem;
  }
} */
@media (min-width: 36rem) {
  .listBox {
    min-width: 30rem;
  }
}
.clearFilter {
  position: absolute;
  right:4px;
  background: none;
  border: none;
  height:100%;
  width: 1.5rem;
  cursor: pointer;
}
/* .xBtn {
  width: 1rem;
height: 1rem;
padding: 4px;
} */
.flex {
  display: flex;
}
.center {
  justify-content: center;
}
.mb2 {
  margin-bottom: 2rem;
}
.w100 {
  width: 100%;
}
.pListL {
  padding-left: 2rem;
}
@media (min-width: 36rem) {
  .pListL {
    padding-left: 15%;
  }
}
.w50 {
  width: 50%;
}
.maxw200 {
  max-width: 200px;
  min-width: 180px;
}
.maxw30 {
  max-width: 30%;
}
.textLeft {
  text-align: left;
}
.capitalize {
  text-transform: capitalize;
}
.bold {
  font-weight: bold;
}
.italic {
  font-style: italic;
}
.green {
  color: rgb(8, 143, 8);
  font-weight: bold;
}
.red {
  color: firebrick;
  font-weight: bold;
}
h2 .red {
  color: #8c1a1a;
  font-weight: 900;
  text-shadow: -0.5px -0.5px 0 rgb(255, 214, 214),
    0.5px -0.5px 0 rgb(255, 214, 214), -0.5px 0.5px 0 rgb(255, 214, 214),
    0.5px 0.5px 0 rgb(255, 214, 214);
}
h2 .green {
  color: #5bd05b;
  font-weight: 900;
}
.red,
.green {
  /* text-shadow: -0.5px -0.5px 0 rgb(255, 214, 214),
    0.5px -0.5px 0 rgb(255, 214, 214), -0.5px 0.5px 0 rgb(255, 214, 214),
    0.5px 0.5px 0 rgb(255, 214, 214); */
}
.copyright {
  display: block;
  width: 100%;
  margin-bottom: 0.5rem;
  padding-top: 4rem;
  font-size: 0.75rem;
}
.santaQuote {
  margin: 0 auto;
  max-width: fit-content;
  text-align: right;
  font-size: larger;
  font-family: "Cedarville Cursive", cursive;
}
</style>
